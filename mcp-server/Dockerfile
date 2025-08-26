FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --only=production

# Copy source code
COPY . .

# Expose MCP server port
EXPOSE 8080

# Start the MCP server
CMD ["npm", "start"]