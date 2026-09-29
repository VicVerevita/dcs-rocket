# syntax=docker/dockerfile:1

#
# Build dependencies
#
FROM node:22-bookworm-slim AS deps

WORKDIR /app

# better-sqlite3 is a native dependency.
# These tools make the build reliable even if no prebuilt binary is available.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        make \
        g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

RUN npm ci --omit=dev


#
# Runtime
#
FROM node:22-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts

# Persistent SQLite location
RUN mkdir -p /app/data \
    && chown -R node:node /app/data

USER node

CMD ["npm", "start"]