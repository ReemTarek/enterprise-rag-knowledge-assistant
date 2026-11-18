var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/", () => "EnterpriseRag API");

app.Run();
