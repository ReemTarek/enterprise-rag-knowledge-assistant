namespace EnterpriseRag.Domain.KnowledgeBases;

/// <summary>Ordered by privilege: a higher value includes the rights of every lower one.</summary>
public enum KnowledgeBaseRole
{
    Viewer = 0,
    Editor = 1,
    Owner = 2,
}
