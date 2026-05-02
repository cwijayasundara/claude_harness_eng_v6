FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git gh ca-certificates bash openssh-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY src ./src

RUN mkdir -p /workspaces

ENV NODE_ENV=production
ENV WORKSPACE_ROOT=/workspaces

CMD ["node", "src/index.js"]
