FROM node:24-slim
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter @boardreadyops/web...
RUN pnpm --filter @boardreadyops/web build
EXPOSE 3000
CMD ["pnpm", "--filter", "@boardreadyops/web", "start"]
