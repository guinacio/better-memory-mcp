FROM node:22.12-alpine AS builder

WORKDIR /app

# Copy only package.json (not lock file to avoid platform-specific deps)
COPY package.json tsconfig.json ./
COPY index.ts ./

# Install deps, forcing past platform checks for optional deps
RUN npm install --force --ignore-scripts
RUN npm run build

FROM node:22-alpine AS release

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production

RUN npm install --omit=dev --force --ignore-scripts

ENTRYPOINT ["node", "dist/index.js"]
