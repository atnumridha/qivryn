#!/bin/bash
# Build the hub-api first
(cd api && npm run build)

# Build the SDK
node ./node_modules/typescript/bin/tsc

# Create the necessary directory structure in dist
mkdir -p dist/api/dist

# Copy the hub-api dist files to the SDK dist
cp -r api/dist/* dist/api/dist/

# Copy the package.json to ensure proper resolution
cp api/package.json dist/api/
