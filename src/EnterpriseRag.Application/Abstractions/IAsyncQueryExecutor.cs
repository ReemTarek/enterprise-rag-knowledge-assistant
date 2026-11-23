namespace EnterpriseRag.Application.Abstractions;

/// <summary>Executes <see cref="IQueryable{T}"/> queries asynchronously without exposing the ORM to Application.</summary>
public interface IAsyncQueryExecutor
{
    Task<List<T>> ToListAsync<T>(IQueryable<T> query, CancellationToken cancellationToken);

    Task<T?> FirstOrDefaultAsync<T>(IQueryable<T> query, CancellationToken cancellationToken);

    Task<bool> AnyAsync<T>(IQueryable<T> query, CancellationToken cancellationToken);

    Task<int> CountAsync<T>(IQueryable<T> query, CancellationToken cancellationToken);
}
