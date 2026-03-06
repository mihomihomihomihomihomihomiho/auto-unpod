# auto-unpod

Automated podcast transcription and processing system that handles audio files from Google Cloud Storage, transcribes them using Google Speech-to-Text, and publishes results to Notion.

## Features

- Automatic transcription of audio files from GCS
- Long-running audio transcription support
- Markdown output generation
- Notion integration for result publishing
- Progress tracking and error handling
- Incremental processing support

## Setup

### Prerequisites

- Python 3.11 or higher
- Google Cloud Platform account with:
  - Cloud Storage access
  - Speech-to-Text API enabled
- Notion workspace with API access

### Installation

```bash
# Install dependencies using uv
cd auto-unpod
make install

# Or manually with uv
uv sync
```

### Configuration

Create a `.env` file in the project root:

```env
# Google Cloud
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
GCS_BUCKET_NAME=your-bucket-name

# Notion
NOTION_API_KEY=your-notion-api-key
NOTION_DATABASE_ID=your-database-id
```

## Usage

```bash
# Run transcription processing
uv run auto-unpod process

# Check status
uv run auto-unpod status
```

## Development

```bash
# Run all checks (lint, format, type check)
make check

# Run tests
make test

# Format code
make format
```

## Architecture

The system is designed with a modular approach:

- `src/auto_unpod/gcs/` - Google Cloud Storage integration
- `src/auto_unpod/transcription/` - Speech-to-Text processing
- `src/auto_unpod/notion/` - Notion API integration
- `src/auto_unpod/core/` - Core business logic and orchestration

## License

MIT
