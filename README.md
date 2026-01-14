# 🎯 Faceit Predictor for CS2

![Python](https://img.shields.io/badge/Python-3.12%2B-blue)
![PyTorch](https://img.shields.io/badge/PyTorch-Deep%20Learning-red)
![FastAPI](https://img.shields.io/badge/FastAPI-Backend-violet)
![ONNX](https://img.shields.io/badge/ONNX-Inference-yellow)
![Chrome](https://img.shields.io/badge/Chrome-Extension-chrome)
[![ru](https://img.shields.io/badge/lang-ru-green.svg)](https://github.com/your-username/faceit-predictor/blob/main/README_RU.md)

**Faceit Predictor** is an intelligent system designed to predict Counter-Strike 2 match outcomes on the FACEIT platform in real-time. The project utilizes a DeepSets neural network architecture to analyze player statistics and display win probabilities for each team directly in the browser.

## ✨ Features

*   **Real-time Prediction:** Analyzes the match immediately after the lobby is formed (during the Map picking phase).
*   **Deep Analytics:** Considers over 40 parameters per player (ELO, K/D, lifetime ADR, last 5/50 matches stats, specific map performance).
*   **Map Awareness:** A specialized model is trained for each competitive map (Mirage, Ancient, Nuke, etc.) to ensure accuracy.
*   **Chrome Extension:** A convenient widget that integrates seamlessly into the Faceit matchroom interface.
*   **High Performance:** Powered by ONNX Runtime for millisecond-level model inference.

## 🏗 Architecture

The project consists of three main modules:

1.  **Data Pipeline & Training (`/train`)**:
    *   Asynchronous parser (`aiohttp`) to harvest historical Faceit matches.
    *   Data preprocessing and missing value handling.
    *   Neural network training using PyTorch.
    *   Weights export to ONNX format.
2.  **Backend Server (`server.py`)**:
    *   FastAPI service.
    *   On-the-fly parsing of the current match.
    *   ONNX model inference.
3.  **Frontend (`/extension`)**:
    *   Browser extension (Manifest V3).
    *   UI injection into the Faceit DOM tree.

## 🚀 Installation & Setup

### 1. Backend Server

```bash
# Clone the repository
git clone https://github.com/your-username/faceit-predictor.git
cd faceit-predictor

# Install dependencies
pip install -r requirements.txt

# Run the server (ensure .onnx models are located in the models/ folder)
python server.py
```

### 2. Model Training (Optional)

If you wish to retrain the model on your own data:
1.  Obtain UIDs of users whose matches you want to scrape.
2.  Run the match parser: `python parse_matches.py`
3.  To expand the player base, you can run `python get_active_uids`
4.  Open `model.ipynb` in Jupyter Notebook and execute the cells for training and exporting.

### 3. Chrome Extension

1.  Navigate to `chrome://extensions/` in your browser.
2.  Enable **"Developer mode"** in the top right corner.
3.  Click **"Load unpacked"**.
4.  Select the folder containing the extension files (`manifest.json`, `content.js`, `styles.css`, etc.).
5.  *Note:* Update the server address in `manifest.json` and `content.js` to your own server URL if the default one is offline.

## 🧠 How it works?

The model employs a permutation-invariant architecture:
1.  **Embedding Layer:** Converts raw stats of each player (10 players total) into a hidden representation.
2.  **Aggregation:** Sums up player vectors for Team 1 and Team 2 separately.
3.  **Comparative Layer:** Compares the "strength" of the aggregated teams and outputs a probability via a Sigmoid function.

## 📄 License

MIT License