using EnterpriseRag.Shared.Options;
using Serilog;
using Serilog.Formatting.Compact;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddSerilog((services, logger) =>
{
    logger
        .ReadFrom.Configuration(builder.Configuration)
        .ReadFrom.Services(services)
        .Enrich.FromLogContext();

    if (builder.Environment.IsDevelopment())
    {
        logger.WriteTo.Console();
    }
    else
    {
        logger.WriteTo.Console(new RenderedCompactJsonFormatter());
    }
});

builder.Services.AddValidatedOptions<AiOptions>(builder.Configuration, "Ai");
builder.Services.AddValidatedOptions<RagOptions>(builder.Configuration, "Rag");

var host = builder.Build();
await host.RunAsync();
