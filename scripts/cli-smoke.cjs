const { runCli, outputSchema } = require("../src/runtime/cli.cjs");
const { randomUUID } = require("node:crypto");
(async () => {
  const result = await runCli({
    role: "intake-smoke",
    prompt:
      "Extract explicit product description. Leave every other unknown field null with status unknown and empty sourceMessageIds. Use the supplied user message id for productDescription. Return no questions and no limitations. Do not use tools.",
    input: {
      intakeId: randomUUID(),
      language: "tr",
      previousProduct: null,
      messages: [
        {
          id: randomUUID(),
          role: "user",
          content:
            "Haftalık yemek planı oluşturan bir uygulama geliştiriyorum.",
          createdAt: new Date().toISOString(),
        },
      ],
    },
    outputSchema: outputSchema("intake", "ExtractOutput"),
    timeoutMs: 45000,
  });
  console.log(
    JSON.stringify({
      status: "ok",
      description: result.product.productDescription.status,
      pricing: result.product.pricing.status,
    }),
  );
})().catch((e) => {
  console.error(
    JSON.stringify({ status: "failed", code: e.code, message: e.message }),
  );
  process.exitCode = 1;
});
