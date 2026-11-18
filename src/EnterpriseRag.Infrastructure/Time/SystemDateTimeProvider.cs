using EnterpriseRag.Application.Abstractions;

namespace EnterpriseRag.Infrastructure.Time;

public sealed class SystemDateTimeProvider : IDateTimeProvider
{
    public DateTime UtcNow => DateTime.UtcNow;
}
