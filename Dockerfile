# Use a specialized Puppeteer-friendly image
FROM ghcr.io/puppeteer/puppeteer:latest

# Switch to root to install any missing tools if needed
USER root

# Set the working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of your application code
COPY . .

# Expose the port (Render uses 10000 by default, but we'll use our ENV)
EXPOSE 10000

# Start the application
CMD ["node", "server.js"]
