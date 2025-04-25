FROM node:18

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    procps \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm install

COPY . .

# Set environment variables
ENV DOCKER_HOST=unix:///var/run/docker.sock
ENV NODE_ENV=production

# Expose the port
EXPOSE 3003

# Run as root to access system information
USER root

CMD ["npm", "start"]
