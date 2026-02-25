# POC

https://vimeo.com/1168920102?fl=ip&fe=ec

# Write-up

https://medium.com/p/d8ebc9dd06ac

# Data Processing API & Elasticsearch Stack

This project provides a FastAPI-based backend that accepts audio or image files, extracts text using GPU-accelerated machine learning models (Whisper and Docling), and pushes the extracted data into a local Elasticsearch and Kibana stack.

## 💻 Prerequisites & Hardware Requirements

Before starting, ensure your system meets the following requirements:

* **NVIDIA GPU**: Required for hardware acceleration. The Python API relies on CUDA for `faster-whisper` and `docling`.
* **CUDA Toolkit**: Installed and properly configured on your host machine.
* **Docker & Docker Compose**: To run the Elasticsearch and Kibana containers.
* **Python 3.10+**: To run the FastAPI application.

## 🔐 Required Configuration Updates

Before spinning up the containers or running the API, you must update the placeholder security values to match across the application. 

### 1. Update `docker-compose.yml`
Open the `docker-compose.yml` file and replace the following values:

* **`ELASTIC_PASSWORD`**: Change `changeme123` to a secure password (under both `elasticsearch` and `kibana` services).
* **`ELASTICSEARCH_PASSWORD`**: Change `changeme123` to match the password above.
* **Kibana Encryption Keys**: Kibana requires three distinct, 32-character alphanumeric strings. You can generate these using a tool like `openssl rand -hex 16`. Replace these placeholders:
    * `XPACK_SECURITY_ENCRYPTIONKEY=a_32_character_long_secret_key_1`
    * `XPACK_ENCRYPTEDSAVEDOBJECTS_ENCRYPTIONKEY=a_32_character_long_secret_key_2`
    * `XPACK_REPORTING_ENCRYPTIONKEY=a_32_character_long_secret_key_3`

### 2. Update `main.py`
Open `main.py` and ensure the Elasticsearch client credentials match what you set in the Docker setup:

* Find the `es_client = Elasticsearch(...)` block.
* Change the password `"changeme123"` to the exact password you used for `ELASTIC_PASSWORD`.

---

## 🚀 Installation & Setup

### Step 1: Start the Elastic Stack
Navigate to the directory containing your `docker-compose.yml` and start the database and dashboard:

```bash
docker-compose up -d
```

## Install Python Dependencies
```
python -m venv venv
```
```
source venv/bin/activate  # On Windows use: venv\Scripts\activate
```
```
pip install fastapi uvicorn python-multipart faster-whisper docling elasticsearch torch
```
## Run the API Server
```
python3 -m venv project_env
```
```
source er_env/bin/activate
```
```
uvicorn main:app --host 0.0.0.0 --port 8000
```


