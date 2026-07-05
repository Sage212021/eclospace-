import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);

buildApp()
  .then((app) => app.listen({ port, host: "0.0.0.0" }))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
