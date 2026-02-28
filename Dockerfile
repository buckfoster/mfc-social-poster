FROM node:22-slim

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN addgroup --system app && adduser --system --ingroup app app
USER app

EXPOSE 3100

CMD ["node", "src/index.js"]
