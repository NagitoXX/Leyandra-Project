"""Inferencia del modelo de captioning (Livrable 3).

Clases idénticas a las de captioning_train.py (generado por el notebook),
más la carga de los artefactos guardados en modele_captioning/.
"""

import json
from pathlib import Path

import numpy as np
import tensorflow as tf

ATTENTION_FEATURES, FEATURES = 64, 2048  # InceptionV3: 64 regiones x 2048 valores


class CNN_Encoder(tf.keras.Model):
    def __init__(self, embedding_dim):
        super().__init__()
        self.fc = tf.keras.layers.Dense(embedding_dim)

    def call(self, x):
        return tf.nn.relu(self.fc(x))


class BahdanauAttention(tf.keras.Model):
    def __init__(self, units):
        super().__init__()
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
    def __init__(self, embedding_dim, units, vocab_size):
        super().__init__()
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
    # Mismo decoder, con dropout (inactivo en inferencia)
    def __init__(self, embedding_dim, units, vocab_size, embedding_matrix, dropout_rate=0.3):
        super().__init__(embedding_dim, units, vocab_size)
        self.embedding = tf.keras.layers.Embedding(
            vocab_size, embedding_dim,
            embeddings_initializer=tf.keras.initializers.Constant(embedding_matrix),
            trainable=True)
        self.dropout = tf.keras.layers.Dropout(dropout_rate)

    def call(self, x, features, hidden, training=False):
        context_vector, attention_weights = self.attention(features, hidden)
        x = self.embedding(x)
        x = tf.concat([tf.expand_dims(context_vector, 1), x], axis=-1)
        x = self.dropout(x, training=training)
        output, state = self.gru(x)
        y = self.fc1(output)
        y = tf.reshape(y, (-1, y.shape[2]))
        y = self.dropout(y, training=training)
        y = self.fc2(y)
        return y, state, attention_weights


def build(enc, dec):
    # Una llamada con entrada vacía para que cada capa cree sus pesos
    # (necesario antes de cargar los pesos guardados)
    features = enc(tf.zeros((1, ATTENTION_FEATURES, FEATURES)))
    dec(tf.zeros((1, 1), tf.int32), features, dec.reset_state(1))


class SimpleTokenizer:
    """Solo lo que la generación necesita: word_index e index_word."""

    def __init__(self, word_index, index_word):
        self.word_index = word_index
        self.index_word = index_word


def _maybe_json(value):
    # Tokenizer.to_json guarda estos campos como cadenas JSON
    return json.loads(value) if isinstance(value, str) else value


def load_captioner(caption_dir):
    caption_dir = Path(caption_dir)
    with open(caption_dir / "config.json", encoding="utf-8") as f:
        cfg = json.load(f)
    with open(caption_dir / "tokenizer.json", encoding="utf-8") as f:
        tok_cfg = json.load(f)["config"]

    word_index = _maybe_json(tok_cfg["word_index"])
    index_word = {int(k): v for k, v in _maybe_json(tok_cfg["index_word"]).items()}
    tokenizer = SimpleTokenizer(word_index, index_word)

    vocab_size, glove_dim = cfg["vocab_size"], cfg["glove_dim"]
    encoder = CNN_Encoder(cfg["embedding_dim"])
    decoder = RNN_Decoder_v2(glove_dim, cfg["units"], vocab_size,
                             np.zeros((vocab_size, glove_dim), "float32"))
    build(encoder, decoder)
    encoder.load_weights(str(caption_dir / "encoder.weights.h5"))
    decoder.load_weights(str(caption_dir / "decoder.weights.h5"))
    return encoder, decoder, tokenizer, cfg["max_length"]


def encode_array(img_uint8, inception, encoder):
    # Imagen (array RGB uint8) -> InceptionV3 -> 64x2048 -> encoder
    img = tf.cast(img_uint8, tf.float32)
    img = tf.image.resize(img, (299, 299))
    img = tf.keras.applications.inception_v3.preprocess_input(img)
    feats = inception(tf.expand_dims(img, 0))
    feats = tf.reshape(feats, (feats.shape[0], -1, feats.shape[3]))
    return encoder(feats)


def repeats_pair(tokens):
    # True si los dos últimos words ya aparecen juntos antes en la frase
    if len(tokens) < 3:
        return False
    last = (tokens[-2], tokens[-1])
    return any((tokens[i], tokens[i + 1]) == last for i in range(len(tokens) - 2))


def beam_search_caption(features, dec, tok, max_len, beam_width=3):
    start_id, end_id = tok.word_index['<start>'], tok.word_index['<end>']
    beams = [([start_id], 0.0, dec.reset_state(batch_size=1), [])]
    finished = []
    for _ in range(max_len):
        candidates = []
        for tokens, score, hidden, att in beams:
            predictions, new_hidden, attention_weights = dec(
                tf.expand_dims([tokens[-1]], 0), features, hidden)
            log_probs = tf.nn.log_softmax(predictions[0]).numpy()
            added = 0
            for w in np.argsort(log_probs)[::-1]:          # palabras más probables primero
                w = int(w)
                if w == 0 or repeats_pair(tokens + [w]):   # ni <pad>, ni pares repetidos
                    continue
                candidates.append((tokens + [w], score + log_probs[w], new_hidden,
                                   att + [attention_weights.numpy().reshape(-1)]))
                added += 1
                if added == beam_width:
                    break
        score = lambda c: c[1] / len(c[0])   # normalizado, para no favorecer frases cortas
        candidates.sort(key=score, reverse=True)
        beams = []
        for c in candidates:
            if c[0][-1] == end_id:
                finished.append(c)
            else:
                beams.append(c)
            if len(beams) == beam_width:
                break
        if not beams:
            break
    best = max(finished if finished else beams, key=lambda c: c[1] / len(c[0]))
    words = [tok.index_word.get(t, '<unk>') for t in best[0][1:]]
    return ' '.join(w for w in words if w not in ('<start>', '<end>'))