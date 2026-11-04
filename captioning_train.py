# Training of the second captioning model (Section 6.5). The notebook runs this file in its own process:
# if the GPU fails, only this process stops, and the notebook starts it again from the last saved epoch.
import json
import os
import sys
import time

import numpy as np
import tensorflow as tf

ATTENTION_FEATURES, FEATURES = 64, 2048       # InceptionV3 features: 64 regions x 2048 values


class CNN_Encoder(tf.keras.Model):
    # Same as Section 3: one dense layer + ReLU on each of the 64 regions
    def __init__(self, embedding_dim):
        super(CNN_Encoder, self).__init__()
        self.fc = tf.keras.layers.Dense(embedding_dim)

    def call(self, x):
        return tf.nn.relu(self.fc(x))


class BahdanauAttention(tf.keras.Model):
    # Same as Section 3: one weight per region, context vector = weighted sum of the regions
    def __init__(self, units):
        super(BahdanauAttention, self).__init__()
        self.W1 = tf.keras.layers.Dense(units)
        self.W2 = tf.keras.layers.Dense(units)
        self.V = tf.keras.layers.Dense(1)

    def call(self, features, hidden):
        hidden_with_time_axis = tf.expand_dims(hidden, 1)
        attention_hidden_layer = tf.nn.tanh(self.W1(features) + self.W2(hidden_with_time_axis))
        attention_weights = tf.nn.softmax(self.V(attention_hidden_layer), axis=1)
        context_vector = tf.reduce_sum(attention_weights * features, axis=1)
        return context_vector, attention_weights


class RNN_Decoder(tf.keras.Model):
    # Same as Section 3
    def __init__(self, embedding_dim, units, vocab_size):
        super(RNN_Decoder, self).__init__()
        self.units = units
        self.embedding = tf.keras.layers.Embedding(vocab_size, embedding_dim)
        self.gru = tf.keras.layers.GRU(self.units, return_sequences=True, return_state=True,
                                       recurrent_initializer='glorot_uniform')
        self.fc1 = tf.keras.layers.Dense(self.units)
        self.fc2 = tf.keras.layers.Dense(vocab_size)
        self.attention = BahdanauAttention(self.units)

    def reset_state(self, batch_size):
        return tf.zeros((batch_size, self.units))


class RNN_Decoder_v2(RNN_Decoder):
    # Same decoder, with GloVe word vectors and dropout (active only during training)
    def __init__(self, embedding_dim, units, vocab_size, embedding_matrix, dropout_rate=0.3):
        super(RNN_Decoder_v2, self).__init__(embedding_dim, units, vocab_size)
        # Word vectors initialised with GloVe, still trainable
        self.embedding = tf.keras.layers.Embedding(vocab_size, embedding_dim,
                                                   embeddings_initializer=tf.keras.initializers.Constant(embedding_matrix),
                                                   trainable=True)
        self.dropout = tf.keras.layers.Dropout(dropout_rate)

    def call(self, x, features, hidden, training=False):
        context_vector, attention_weights = self.attention(features, hidden)
        x = self.embedding(x)
        x = tf.concat([tf.expand_dims(context_vector, 1), x], axis=-1)
        x = self.dropout(x, training=training)          # dropout on the input of the GRU
        output, state = self.gru(x)
        y = self.fc1(output)
        y = tf.reshape(y, (-1, y.shape[2]))
        y = self.dropout(y, training=training)          # dropout before the last layer
        y = self.fc2(y)
        return y, state, attention_weights


def build(enc, dec):
    # One call on an empty input so that every layer creates its weights (needed before loading saved weights)
    features = enc(tf.zeros((1, ATTENTION_FEATURES, FEATURES)))
    dec(tf.zeros((1, 1), tf.int32), features, dec.reset_state(1))


loss_object = tf.keras.losses.SparseCategoricalCrossentropy(from_logits=True, reduction='none')

def loss_function(real, pred):
    # Same as Section 3: the <pad> positions are not counted
    mask = tf.cast(tf.math.not_equal(real, 0), tf.float32)
    return tf.reduce_mean(loss_object(real, pred) * mask)

def masked_loss_sum(real, pred):
    # Sum of the losses of the real words, and number of real words
    mask = tf.cast(tf.math.not_equal(real, 0), tf.float32)
    return tf.reduce_sum(loss_object(real, pred) * mask), tf.reduce_sum(mask)


def make_shard_dataset(shard_files, shard_sizes, starts, counts, caps, batch_size, buffer_size, shuffle_data=True):
    # The features are packed in big float16 files (6.5), read one after the other at the full speed of the disk.
    # Each image is then paired with each of its captions, like make_dataset in Section 6.1.
    first = np.concatenate([[0], np.cumsum(shard_sizes)[:-1]]).astype(np.int32)   # first image of each file
    starts_t = tf.constant(starts, tf.int32)
    counts_t = tf.constant(counts, tf.int32)
    caps_t = tf.constant(caps, tf.int32)

    ds = tf.data.Dataset.from_tensor_slices((np.asarray(shard_files), first, np.asarray(shard_sizes, np.int32)))
    if shuffle_data:
        ds = ds.shuffle(len(shard_files))                     # new order of the files at every epoch

    def load_shard(path, first_image, n_images):
        feats = tf.numpy_function(lambda p: np.load(p.decode("utf-8"), mmap_mode="r"), [path], tf.float16)
        feats.set_shape((None, ATTENTION_FEATURES, FEATURES))
        return feats, starts_t[first_image:first_image + n_images], counts_t[first_image:first_image + n_images]

    ds = ds.map(load_shard).prefetch(1)                       # the next file is read while this one is used
    ds = ds.flat_map(lambda feats, s, c: tf.data.Dataset.from_tensor_slices((feats, s, c)))   # one element per image
    if shuffle_data:
        ds = ds.shuffle(2000)                                 # the images are mixed (about one file)
    ds = ds.flat_map(lambda feat, s, c: tf.data.Dataset.from_tensor_slices(
        (tf.repeat(feat[None], c, axis=0), caps_t[s:s + c])))   # one pair per caption
    if shuffle_data:
        ds = ds.shuffle(buffer_size)
    # The features stay in float16 in the buffers (half the RAM) and become float32 only once batched:
    # the values are exactly the same, but the first training run ran out of memory without this
    ds = ds.batch(batch_size).map(lambda f, t: (tf.cast(f, tf.float32), t))
    return ds.prefetch(2)


def make_steps(enc, dec, opt, start_id):
    # Training step (same as Section 4, teacher forcing) and loss step (same thing, without updating the weights).
    # Both return the sum of the losses of the real words and their number.
    @tf.function
    def train_step(img_tensor, target):
        loss, total, count = 0.0, 0.0, 0.0
        hidden = dec.reset_state(batch_size=target.shape[0])
        dec_input = tf.expand_dims([start_id] * target.shape[0], 1)
        with tf.GradientTape() as tape:
            features = enc(img_tensor)
            for i in range(1, target.shape[1]):
                predictions, hidden, _ = dec(dec_input, features, hidden, training=True)
                loss += loss_function(target[:, i], predictions)
                s, n = masked_loss_sum(target[:, i], predictions)
                total += s
                count += n
                dec_input = tf.expand_dims(target[:, i], 1)
        trainable_variables = enc.trainable_variables + dec.trainable_variables
        gradients = tape.gradient(loss, trainable_variables)
        opt.apply_gradients(zip(gradients, trainable_variables))
        return total, count

    @tf.function
    def loss_step(img_tensor, target):
        total, count = 0.0, 0.0
        hidden = dec.reset_state(batch_size=target.shape[0])
        dec_input = tf.expand_dims([start_id] * target.shape[0], 1)
        features = enc(img_tensor)
        for i in range(1, target.shape[1]):
            predictions, hidden, _ = dec(dec_input, features, hidden)
            s, n = masked_loss_sum(target[:, i], predictions)
            total += s
            count += n
            dec_input = tf.expand_dims(target[:, i], 1)
        return total, count

    return train_step, loss_step


def mean_word_loss(step, ds):
    # Average loss per real word over a whole dataset
    total, count = 0.0, 0.0
    for img_tensor, target in ds:
        s, n = step(img_tensor, target)
        total += float(s)
        count += float(n)
    return total / count


def save_state(enc, dec, opt, folder, with_optimizer=False):
    # save_weights keeps every layer (GRU and attention included)
    enc.save_weights(os.path.join(folder, "encoder.weights.h5"))
    dec.save_weights(os.path.join(folder, "decoder.weights.h5"))
    if with_optimizer:
        np.savez(os.path.join(folder, "optimizer.npz"), *[v.numpy() for v in opt.variables])

def load_state(enc, dec, opt, folder, with_optimizer=False):
    enc.load_weights(os.path.join(folder, "encoder.weights.h5"))
    dec.load_weights(os.path.join(folder, "decoder.weights.h5"))
    if with_optimizer:
        saved = np.load(os.path.join(folder, "optimizer.npz"))
        for v, k in zip(opt.variables, saved.files):
            v.assign(saved[k])


def main(data_file):
    # The GPU memory is taken as needed, the notebook also uses some
    for gpu in tf.config.list_physical_devices("GPU"):
        tf.config.experimental.set_memory_growth(gpu, True)

    data = np.load(data_file)
    cfg = json.loads(str(data["config"]))
    def split(name, shuffle_data):
        return make_shard_dataset(data[f"{name}_shards"], data[f"{name}_sizes"], data[f"{name}_starts"],
                                  data[f"{name}_counts"], data[f"{name}_caps"], cfg["batch_size"], cfg["buffer_size"],
                                  shuffle_data=shuffle_data)
    train_ds = split("train", True)
    val_ds = split("val", False)

    encoder = CNN_Encoder(cfg["embedding_dim"])
    decoder = RNN_Decoder_v2(cfg["glove_dim"], cfg["units"], cfg["vocab_size"], data["embedding_matrix"])
    optimizer = tf.keras.optimizers.Adam()
    build(encoder, decoder)
    optimizer.build(encoder.trainable_variables + decoder.trainable_variables)
    train_step, loss_step = make_steps(encoder, decoder, optimizer, cfg["start_id"])

    best_dir, last_dir = cfg["best_dir"], cfg["last_dir"]
    os.makedirs(best_dir, exist_ok=True)
    os.makedirs(last_dir, exist_ok=True)
    history_file = os.path.join(last_dir, "history.json")
    train_hist, val_hist, best_val, wait = [], [], float("inf"), 0

    # After a stop (GPU error...), resume after the last finished epoch
    if os.path.exists(history_file):
        load_state(encoder, decoder, optimizer, last_dir, with_optimizer=True)
        with open(history_file) as f:
            state = json.load(f)
        train_hist, val_hist, best_val, wait = state["train"], state["val"], state["best_val"], state["wait"]
        print(f"Resuming after epoch {len(train_hist)} (best validation loss so far: {best_val:.4f})", flush=True)

    for epoch in range(len(train_hist), cfg["epochs"]):
        if wait >= cfg["patience"]:                      # the training had already stopped
            break
        start = time.time()
        train_loss = mean_word_loss(train_step, train_ds)    # one pass on the training set, with weight updates
        val_loss = mean_word_loss(loss_step, val_ds)
        train_hist.append(train_loss)
        val_hist.append(val_loss)
        print(f"Epoch {epoch + 1} | training loss {train_loss:.4f} | validation loss {val_loss:.4f} | "
              f"{time.time() - start:.0f} sec", flush=True)

        if val_loss < best_val:
            best_val, wait = val_loss, 0
            save_state(encoder, decoder, optimizer, best_dir)            # weights of the best epoch so far
        else:
            wait += 1

        # State of this epoch, to be able to resume from here
        save_state(encoder, decoder, optimizer, last_dir, with_optimizer=True)
        with open(history_file, "w") as f:
            json.dump({"train": train_hist, "val": val_hist, "best_val": best_val, "wait": wait}, f)

        if wait >= cfg["patience"]:
            print(f"Early stopping: no improvement for {cfg['patience']} epochs", flush=True)
            break


if __name__ == "__main__":
    try:
        main(sys.argv[1])
    except (tf.errors.InternalError, tf.errors.UnknownError) as e:
        print("GPU error:", str(e).splitlines()[0], flush=True)
        sys.exit(3)                                       # the notebook starts the training again
