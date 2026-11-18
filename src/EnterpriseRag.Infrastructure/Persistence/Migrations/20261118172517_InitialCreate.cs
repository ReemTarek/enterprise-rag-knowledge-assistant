using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EnterpriseRag.Infrastructure.Persistence.Migrations;

/// <inheritdoc />
public partial class _20261118172517_InitialCreate : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "AuditLogs",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                Action = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                ActorId = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                TargetType = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                TargetId = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                OccurredAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                DetailsJson = table.Column<string>(type: "nvarchar(max)", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_AuditLogs", x => x.Id);
            });

        migrationBuilder.CreateIndex(
            name: "IX_AuditLogs_OccurredAt",
            table: "AuditLogs",
            column: "OccurredAt");
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(
            name: "AuditLogs");
    }
}
