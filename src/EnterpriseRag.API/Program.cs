using EnterpriseRag.API.Auth;
using EnterpriseRag.API.Health;
using EnterpriseRag.API.Middleware;
using EnterpriseRag.API.Services;
using EnterpriseRag.Application;
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
builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddValidatedOptions<AiOptions>(builder.Configuration, "Ai");
builder.Services.AddValidatedOptions<RagOptions>(builder.Configuration, "Rag");

builder.Services.AddControllers()
    // Malformed JSON gets a generic model-state message instead of the parser's (which can quote the input).
    .AddJsonOptions(options =>
    {
        options.AllowInputFormatterExceptionMessages = false;
        options.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
    });
builder.Services.AddApiAuthentication();
builder.Services.AddApiRateLimiting();

builder.Services.AddApiHealthChecks();
builder.Services.AddProblemDetails(options =>
    options.CustomizeProblemDetails = context =>
    {
        // Covers ProblemDetails produced by MVC (e.g. automatic model-validation 400s) as well.
        var correlationId = CorrelationIdMiddleware.Get(context.HttpContext);
        if (correlationId is not null)
        {
            context.ProblemDetails.Extensions.TryAdd("correlationId", correlationId);
        }
    });
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

app.UseRouting();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/", () => "EnterpriseRag API").AllowAnonymous();
app.MapHealthEndpoints();
app.MapControllers();

app.Run();

public partial class Program;
