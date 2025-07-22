#!/bin/bash
# debug-typesense.sh

echo "🔍 Debugging Typesense container..."

# Check if container exists
container_name="fragmentengine-typesense-1"

echo "1. Container status:"
docker ps -a | grep typesense

echo -e "\n2. Container logs:"
docker logs $container_name --tail 50

echo -e "\n3. Checking if Typesense image has curl for healthcheck:"
docker run --rm typesense/typesense:0.25.1 which curl || echo "❌ curl not found in image"

echo -e "\n4. Testing direct connection:"
docker exec $container_name wget -O- http://localhost:8108/health 2>&1 || echo "❌ Direct connection failed"

echo -e "\n5. Checking port binding:"
docker port $container_name

echo -e "\n6. Inspecting health check status:"
docker inspect $container_name --format='{{json .State.Health}}' | jq
