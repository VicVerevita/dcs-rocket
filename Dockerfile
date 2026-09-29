# syntax=docker/dockerfile:1

#
# Stage 1: install production dependencies
#
FROM node:22-bookworm-slim AS dependencies

WORKDIR /app

# better-sqlite3 is a native Node module.
# Install build tools here only, so they don't bloat the final image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        make \
        g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy these first so Docker can cache npm install
COPY package.json package-lock.json ./

RUN npm ci --omit=dev \
    && npm cache clean --force


#
# Stage 2: production runtime
#
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

# Production dependencies built in the previous stage
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules

# Application files
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh

# SQLite database directory
RUN mkdir -p /app/data \
    && chown -R node:node /app \
    && chmod +x /app/docker-entrypoint.sh

# Don't run the bot as root
USER node

ENTRYPOINT ["./docker-entrypoint.sh"]