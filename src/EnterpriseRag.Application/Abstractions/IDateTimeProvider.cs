namespace EnterpriseRag.Application.Abstractions;

public interface IDateTimeProvider
{
    DateTime UtcNow { get; }
}
