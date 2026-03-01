require("dotenv").config();
const express = require("express");
const cors = require("cors");
const config = require("./shared/config/env");
const authRoutes = require("./modules/auth/auth.routes");
const membershipsRoutes = require("./modules/memberships/memberships.routes");

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/memberships", membershipsRoutes);

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = config.port;
app.listen(port, () => {
  console.log(`Ticketing-back listening on port ${port}`);
});
