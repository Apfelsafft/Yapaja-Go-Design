# Valhalla Routing Service

This directory contains configuration and data for the Valhalla routing service.

## Overview

Valhalla is an open-source routing engine providing route calculation, isochrone generation, and map matching capabilities. The service runs as part of the Yapaja Go docker-compose stack.

## Data Management

Valhalla requires map tiles and configuration files to operate. Initially, this directory is empty and the service will report as unavailable (degraded status).

To provision Valhalla data:
- Script for downloading and configuring tiles: *Planned for E03-T1 (Valhalla data provisioning)*
- Tiles are mounted at `/custom_files` inside the container
- Configuration references: See services/valhalla/README.md and docs/

## Usage

Start with profile:
```bash
docker compose --profile routing up -d
```

Service endpoint: `http://valhalla:8002`
