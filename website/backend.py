
from flask import Flask, jsonify

app = Flask(__name__)

@app.route("/")
def home():
    return jsonify({
        "project": "Leyenda",
        "status": "Backend running successfully!"
    })

if __name__ == "__main__":
    app.run(debug=True)
