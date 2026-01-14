import asyncio
from datetime import datetime

import aiohttp
import onnxruntime as ort
import numpy as np
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from parse_ongoing import process_match, TRACKED_COUNTRIES

models_cache = {}

prediction_cache = {}

cache_order = []

lock = asyncio.Lock()


def load_models():
    """Loads models once while server is starting"""
    maps = ['mirage', 'dust2', 'inferno', 'ancient', 'nuke', 'overpass', 'train', 'anubis']
    for m_name in maps:
        m_path = f"models/model_de_{m_name}.onnx"
        s_path = f"models/scaler_params_de_{m_name}.npz"

        if os.path.exists(m_path) and os.path.exists(s_path):
            scaler_data = np.load(s_path)
            models_cache[m_name] = {
                "session": ort.InferenceSession(m_path),
                "mean": scaler_data['mean'],
                "scale": scaler_data['scale']
            }
            log_info(f"Loaded: {m_name}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_models()
    yield
    models_cache.clear()
    prediction_cache.clear()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def log_info(message: str):
    time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{time_str}] INFO: {message}")


def add_to_cache(match_id, data):
    """LRU CACHE"""
    if match_id in prediction_cache:
        return

    if len(prediction_cache) >= 100:
        oldest = cache_order.pop(0)
        prediction_cache.pop(oldest, None)

    prediction_cache[match_id] = data
    cache_order.append(match_id)


@app.get("/predict/{match_id}")
async def get_predictions(match_id: str):
    if match_id in prediction_cache:
        log_info(f"Returned from cache: {match_id}")
        return prediction_cache[match_id]

    async with lock:
        if match_id in prediction_cache:
            return prediction_cache[match_id]

        log_info(f"Parse new match: {match_id}")
        async with aiohttp.ClientSession() as session:
            match_data = await process_match(session, match_id)

        if not match_data:
            log_info(f"Error match: {match_id}")
            raise HTTPException(status_code=404, detail="Data incomplete or match not found")

        results_output = {}
        for m_name, assets in models_cache.items():
            try:
                input_vector = transform_row_for_map(match_data, m_name)
                scaled = (input_vector - assets['mean']) / assets['scale']

                n_features = scaled.shape[1] // 10
                tensor_input = scaled.reshape(1, 10, n_features).astype(np.float32)

                ort_inputs = {assets['session'].get_inputs()[0].name: tensor_input}
                prob = assets['session'].run(None, ort_inputs)[0][0][0]
                results_output[m_name] = round(float(prob) * 100, 2)
            except Exception as e:
                results_output[m_name] = f"Error: {e}"

        final_response = {
            "match_id": match_id,
            "actual_map": match_data.get('map'),
            "predictions": results_output,
            "timestamp": datetime.now().isoformat()
        }

        add_to_cache(match_id, final_response)
        log_info(f"Prediction ready for {match_id}")

        return final_response


def transform_row_for_map(full_row, target_map):
    prefixes = [f"t{t}_p{p}" for t in [1, 2] for p in range(5)]
    base = ['elo', 'party_size', 'is_premium', 'is_free', 'time_diff',
            'life_matches', 'life_wr', 'life_kd', 'life_adr',
            'rec50_opp_skill', 'rec50_wr', 'rec50_kd', 'rec50_adr', 'rec50_hs', 'rec50_k', 'rec50_a', 'rec50_d',
            'rec5_opp_skill', 'rec5_wr', 'rec5_kd', 'rec5_adr', 'rec5_hs', 'rec5_k', 'rec5_a', 'rec5_d']
    map_f = ['matches', 'wr', 'kd', 'adr', 'hs', 'k', 'a', 'd']
    countries = [f"country_{c}" for c in TRACKED_COUNTRIES] + ["country_other"]

    vector = []
    for p in prefixes:
        for f in base: vector.append(full_row.get(f"{p}_{f}", 0))
        for f in map_f: vector.append(full_row.get(f"{p}_{target_map}_{f}", 0))
        for f in countries: vector.append(full_row.get(f"{p}_{f}", 0))

    return np.array(vector).reshape(1, -1)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
