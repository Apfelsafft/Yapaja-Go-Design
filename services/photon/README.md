# Photon Search Service

This directory contains configuration and data for the Photon geocoding and search service.

## Overview

Photon is an open-source address search and geocoding service built on Elasticsearch. It provides fast, offline address lookups for the Yapaja Go application. The service runs as part of the docker-compose stack.

## Data Management

Photon requires indexed geodata to provide search results. Initially, this directory is empty and the service will report as unavailable (degraded status).

To provision Photon data:
- Script for downloading and indexing geodata: *Planned for E05-T4 (Photon data provisioning)*
- Indexed data is persisted in `/photon/photon_data` inside the container
- Baseline data and rebuild instructions: See services/photon/README.md and docs/

## Usage

Start with profile:
```bash
docker compose --profile search up -d
```

Service endpoint: `http://photon:2322`
