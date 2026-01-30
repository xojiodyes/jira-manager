#!/bin/bash
# Start Jira Manager in MOCK mode (test data)
cd "$(dirname "$0")"
MODE=mock node server.js
