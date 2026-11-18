using EnterpriseRag.API.Health;
using EnterpriseRag.API.Middleware;
using EnterpriseRag.API.Services;
using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Infrastructure;
using EnterpriseRag.Shared.Options;
using Serilog;
using Serilog.Formatting.Compact;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, services, logger) =>
{
    logger
        .ReadFrom.Configuration(context.Configuration)
        .ReadFrom.Services(services)
        .Enrich.FromLogContext();

    if (context.HostingEnvironment.IsDevelopment())
    {
        logger.WriteTo.Console();
    }
    else
    {
        logger.WriteTo.Console(new RenderedCompactJsonFormatter());
    }
});

builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUserService, HttpCurrentUserService>();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddValidatedOptions<AiOptions>(builder.Configuration, "Ai");
builder.Services.AddValidatedOptions<RagOptions>(builder.Configuration, "Rag");

builder.Services.AddApiHealthChecks();
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();

if (builder.Environment.IsDevelopment())
{
    builder.Services.AddEndpointsApiExplorer();
    builder.Services.AddSwaggerGen();
}

var app = builder.Build();

app.UseMiddleware<CorrelationIdMiddleware>();
app.UseSerilogRequestLogging();
app.UseExceptionHandler();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.MapGet("/", () => "EnterpriseRag API");
app.MapHealthEndpoints();

app.Run();

public partial class Program;
