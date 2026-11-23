using EnterpriseRag.Application.Common;

namespace EnterpriseRag.Application.Tests.Common;

public class PagingTests
{
    [Theory]
    [InlineData(int.MaxValue, 100)]
    [InlineData(int.MaxValue, 20)]
    [InlineData(int.MaxValue, 0)]
    [InlineData(int.MaxValue / 2, 100)]
    public void Normalize_HugePage_DoesNotOverflow_AndClampsPage(int page, int pageSize)
    {
        var (p, size, skip) = Paging.Normalize(page, pageSize);

        Assert.True(skip >= 0, $"skip overflowed: {skip}");
        Assert.True(p <= int.MaxValue / Paging.MaxPageSize);
        Assert.Equal((long)(p - 1) * size, skip);
    }

    [Theory]
    [InlineData(0, 0, 1, 20, 0)]
    [InlineData(-5, 1000, 1, 100, 0)]
    [InlineData(3, 10, 3, 10, 20)]
    public void Normalize_OrdinaryInput_IsUnchanged(int page, int pageSize, int expectedPage, int expectedSize, int expectedSkip) =>
        Assert.Equal((expectedPage, expectedSize, expectedSkip), Paging.Normalize(page, pageSize));
}
