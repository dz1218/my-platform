FROM node:22-alpine
RUN npm install -g pnpm@10.10.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/agent/package.json apps/agent/package.json
RUN pnpm --filter agent install --frozen-lockfile --ignore-scripts
COPY apps/agent/tsconfig.json apps/agent/tsconfig.json
COPY apps/agent/src/ apps/agent/src/
RUN pnpm --filter agent build
WORKDIR /app/apps/agent
USER node
ENV NODE_ENV=production AGENT_HOST=0.0.0.0 AGENT_PORT=8081
EXPOSE 8081
CMD ["node", "dist/main.js"]
