"""Statistics service for tracking cleanup operations."""

from datetime import datetime, date
from typing import Dict, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from fastapi import Depends
from app.database import get_db
from app.models import CleanupStatistics, DailyStats


class StatisticsService:
    """Service for tracking and retrieving statistics."""
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def record_operation(
        self,
        entity_type: str,
        operation: str,
        items_affected: int,
        documents_affected: int = 0,
        items_before: int = 0,
        items_after: int = 0,
        details: dict = None
    ) -> CleanupStatistics:
        """Record a cleanup operation."""
        stat = CleanupStatistics(
            entity_type=entity_type,
            operation=operation,
            items_before=items_before,
            items_after=items_after,
            items_affected=items_affected,
            documents_affected=documents_affected,
            details=details
        )
        self.db.add(stat)
        
        # Update daily stats
        await self._update_daily_stats(entity_type, operation, items_affected)
        
        await self.db.commit()
        return stat
    
    async def _update_daily_stats(self, entity_type: str, operation: str, count: int):
        """Update daily statistics."""
        today = date.today().isoformat()
        
        result = await self.db.execute(
            select(DailyStats).where(DailyStats.date == today)
        )
        stats = result.scalar_one_or_none()
        
        if not stats:
            stats = DailyStats(date=today)
            self.db.add(stats)
        
        # Update the appropriate counter
        field_name = f"{entity_type}_{operation}"
        if hasattr(stats, field_name):
            current = getattr(stats, field_name) or 0
            setattr(stats, field_name, current + count)
    
    async def get_total_stats(self) -> Dict:
        """Get total statistics across all time."""
        result = await self.db.execute(
            select(
                CleanupStatistics.entity_type,
                CleanupStatistics.operation,
                func.sum(CleanupStatistics.items_affected).label('total_items'),
                func.sum(CleanupStatistics.documents_affected).label('total_docs'),
                func.count(CleanupStatistics.id).label('operation_count')
            ).group_by(
                CleanupStatistics.entity_type,
                CleanupStatistics.operation
            )
        )
        rows = result.all()
        
        stats = {
            'correspondents': {'merged': 0, 'deleted': 0, 'total_operations': 0},
            'tags': {'merged': 0, 'deleted': 0, 'total_operations': 0},
            'document_types': {'merged': 0, 'deleted': 0, 'total_operations': 0},
            'total_items_cleaned': 0,
            'total_documents_affected': 0,
            'total_operations': 0
        }
        
        for row in rows:
            entity_type = row.entity_type
            operation = row.operation
            total_items = row.total_items or 0
            total_docs = row.total_docs or 0
            op_count = row.operation_count or 0
            
            if entity_type in stats:
                if operation in ['merge', 'merged']:
                    stats[entity_type]['merged'] += total_items
                elif operation in ['delete', 'deleted', 'cleanup']:
                    stats[entity_type]['deleted'] += total_items
                stats[entity_type]['total_operations'] += op_count
            
            stats['total_items_cleaned'] += total_items
            stats['total_documents_affected'] += total_docs
            stats['total_operations'] += op_count
        
        return stats
    
    async def get_recent_operations(self, limit: int = 10) -> List[Dict]:
        """Get recent cleanup operations."""
        result = await self.db.execute(
            select(CleanupStatistics)
            .order_by(CleanupStatistics.created_at.desc())
            .limit(limit)
        )
        operations = result.scalars().all()
        
        return [
            {
                'id': op.id,
                'entity_type': op.entity_type,
                'operation': op.operation,
                'items_affected': op.items_affected,
                'documents_affected': op.documents_affected,
                'details': op.details,
                'created_at': op.created_at.isoformat() if op.created_at else None
            }
            for op in operations
        ]
    
    async def get_daily_trend(self, days: int = 7) -> List[Dict]:
        """Get daily statistics for the last N days."""
        result = await self.db.execute(
            select(DailyStats)
            .order_by(DailyStats.date.desc())
            .limit(days)
        )
        daily = result.scalars().all()
        
        return [
            {
                'date': d.date,
                'correspondents_merged': d.correspondents_merged or 0,
                'correspondents_deleted': d.correspondents_deleted or 0,
                'tags_merged': d.tags_merged or 0,
                'tags_deleted': d.tags_deleted or 0,
                'document_types_merged': d.document_types_merged or 0,
                'document_types_deleted': d.document_types_deleted or 0,
            }
            for d in daily
        ]


async def get_statistics_service(db: AsyncSession = Depends(get_db)) -> StatisticsService:
    """Dependency to get statistics service."""
    return StatisticsService(db)

