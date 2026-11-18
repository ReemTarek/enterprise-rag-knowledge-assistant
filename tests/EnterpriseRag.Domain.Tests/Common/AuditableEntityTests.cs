using EnterpriseRag.Domain.Common;

namespace EnterpriseRag.Domain.Tests.Common;

public class AuditableEntityTests
{
    private sealed class TestEntity : SoftDeletableEntity;

    [Fact]
    public void MarkDeleted_SetsIsDeletedAndDeletedAt()
    {
        var entity = new TestEntity();
        var now = new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);

        entity.MarkDeleted(now);

        Assert.True(entity.IsDeleted);
        Assert.Equal(now, entity.DeletedAt);
    }

    [Fact]
    public void MarkDeleted_Twice_ThrowsDomainException()
    {
        var entity = new TestEntity();
        var now = DateTime.UtcNow;
        entity.MarkDeleted(now);

        Assert.Throws<DomainException>(() => entity.MarkDeleted(now));
    }

    [Fact]
    public void MarkDeleted_WithNonUtcKind_ThrowsDomainException()
    {
        var entity = new TestEntity();

        Assert.Throws<DomainException>(() => entity.MarkDeleted(DateTime.Now));
        Assert.False(entity.IsDeleted);
    }
}
