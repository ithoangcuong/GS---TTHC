FROM node:24-bookworm-slim
WORKDIR /app
COPY dist/ /app/
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/app/data/central.sqlite
EXPOSE 3000
CMD ["node", "--env-file-if-exists=.env", "server/main.mjs"]
