from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
from docling.document_converter import DocumentConverter
from elasticsearch import Elasticsearch
import tempfile
import gc
import torch
import os

app = FastAPI(title="Data Processing API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

es_client = Elasticsearch(
    "http://localhost:9200",
    basic_auth=("elastic", "changeme123")
)

@app.post("/analyze-case")
async def process_data(file: UploadFile = File(...)):
    extracted_text = ""
    
    ext = os.path.splitext(file.filename)[1] or ".tmp"
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        if "audio" in file.content_type or file.filename.endswith(('.wav', '.m4a', '.webm')):
            model = WhisperModel("small.en", device="cuda", compute_type="float16")
            segments, _ = model.transcribe(tmp_path, beam_size=5)
            extracted_text = " ".join([segment.text for segment in segments])
            del model

        elif "image" in file.content_type or file.filename.endswith(('.png', '.jpg', '.jpeg')):
            converter = DocumentConverter()
            result = converter.convert(tmp_path)
            extracted_text = result.document.export_to_markdown()
            del converter
            del result

        else:
            raise HTTPException(status_code=400, detail="Unsupported file type. Send audio or image.")

    finally:
        gc.collect()
        torch.cuda.empty_cache()
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    es_client.index(
        index="patient-cases",
        document={"raw_text": extracted_text, "status": "pending_analysis"}
    )

    return {
        "status": "success",
        "source_type": file.content_type,
        "extracted_text": extracted_text
    }
