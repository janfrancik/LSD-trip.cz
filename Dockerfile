FROM node:24-alpine

# Aplikace i databáze běží v pražském čase. Data se ukládají jako DATETIME
# v místním čase, takže časová zóna kontejneru musí být jednoznačná - jinak
# by se "dnešní termíny" lámaly o půlnoci UTC.
RUN apk add --no-cache tzdata
ENV TZ=Europe/Prague

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# Healthcheck se ptá aplikace, ne jen portu - odpověď obsahuje i dostupnost
# databáze, takže kontejner s nefunkční DB se pozná jako nezdravý.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
