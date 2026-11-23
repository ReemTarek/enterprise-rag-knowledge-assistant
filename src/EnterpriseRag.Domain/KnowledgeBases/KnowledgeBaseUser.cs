namespace EnterpriseRag.Domain.KnowledgeBases;

public class KnowledgeBaseUser
{
    public Guid KnowledgeBaseId { get; set; }

    public Guid UserId { get; set; }

    public KnowledgeBaseRole Role { get; set; }
}
