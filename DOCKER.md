# Running Kroger Cart in Docker

## Build

```bash
docker build -t kroger-cart .
```

## Run

```bash
docker run -p 8000:8000 kroger-cart
```

Then open **http://localhost:8000/kroger-cart.html**.

### Custom port

To use a different host port (e.g. 8888):

```bash
docker run -p 8888:8000 -e PORT=8000 kroger-cart
```

Then open **http://localhost:8888/kroger-cart.html**. (The container still listens on 8000; `-p 8888:8000` maps host 8888 → container 8000.)

To change the port inside the container:

```bash
docker run -p 3000:3000 -e PORT=3000 kroger-cart
```

### Kroger OAuth when hosted

The app’s redirect URI is set in the client (e.g. `http://localhost:8000/kroger-oauth-callback.html`). If you host the app elsewhere (e.g. `https://myhost.com`), you must:

1. Build the image with your redirect URI in the client code, or serve the same code and ensure the app knows its public URL.
2. In Kroger Developer Portal → your app → Redirect URIs, add the exact callback URL (e.g. `https://myhost.com/kroger-oauth-callback.html`).

### Ollama (meal plan / grocery list)

The app proxies to Ollama at `http://127.0.0.1:11434` by default. From inside the app container, that’s the container itself, not your machine. You can either use Ollama on the host or run Ollama in Docker.

#### Option A: Ollama on the host (recommended)

Run Ollama normally on your machine (Ollama app or `ollama serve`). Then point the app at the host:

- **Mac or Windows:**
  ```bash
  docker run -p 8000:8000 -e OLLAMA_ORIGIN=http://host.docker.internal:11434 kroger-cart
  ```
  `host.docker.internal` is the host machine from inside the container.

- **Linux:**
  ```bash
  docker run --network host -e OLLAMA_ORIGIN=http://127.0.0.1:11434 kroger-cart
  ```
  Then open **http://localhost:8000/kroger-cart.html**.

#### Option B: Ollama in Docker too

Run both the app and Ollama in Docker on the same network. Use the `docker-compose.yml` in this repo (see below), or manually:

```bash
# Create a network
docker network create kroger-net

# Run Ollama (pull a model first: docker exec -it ollama ollama pull qwen3:8b)
docker run -d --name ollama --network kroger-net -p 11434:11434 ollama/ollama

# Run the app
docker run -p 8000:8000 --network kroger-net -e OLLAMA_ORIGIN=http://ollama:11434 kroger-cart
```

Then open **http://localhost:8000/kroger-cart.html**. Use `docker exec -it ollama ollama pull <model>` to pull models (e.g. `qwen3:8b`) into the Ollama container.

**Or use Docker Compose** (both app + Ollama, one command):

```bash
docker compose up -d
docker exec -it kroger-ollama ollama pull qwen3:8b   # pull model once
```

Then open **http://localhost:8000/kroger-cart.html**. Models are stored in the `ollama-data` volume.

---

## 502 Bad Gateway when generating the grocery list

A **502** from the “Generate meal plan & grocery list” action means the server could not reach **Ollama**.

- **Running locally (no Docker):** Start Ollama on your machine (`ollama serve` or run the Ollama app) and ensure it’s listening on `http://127.0.0.1:11434`. Pull the model you use (e.g. `ollama pull qwen3:8b`).
- **Running in Docker:** The container’s `127.0.0.1` is the container, not the host. Set `OLLAMA_ORIGIN` so the proxy can reach Ollama:
  - **Mac/Windows:** `docker run -p 8000:8000 -e OLLAMA_ORIGIN=http://host.docker.internal:11434 kroger-cart`
  - **Linux:** use `--network host` and run Ollama on the host, or run Ollama in another container and set `OLLAMA_ORIGIN` to that container’s URL.
