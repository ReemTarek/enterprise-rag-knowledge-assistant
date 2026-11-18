using EnterpriseRag.Domain.Common;

namespace EnterpriseRag.Domain.Tests.Common;

public class EntityTests
{
    private sealed class TestEntity : Entity;

    [Fact]
    public void Entity_NewId_IsVersion7()
    {
        var entity = new TestEntity();

        Assert.Equal('7', entity.Id.ToString("N")[12]);
    }
}
