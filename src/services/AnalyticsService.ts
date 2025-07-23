import { Types } from 'mongoose';
import {
  AnalyticsEvent,
  PerformanceMetric,
  ErrorLog,
  Experiment,
  UserExperiment,
  EventType,
  MetricType,
  IAnalyticsEvent,
  IPerformanceMetric,
  IErrorLog,
  IExperiment,
  IUserExperiment
} from '../models';

export interface TrackEventOptions {
  eventType: EventType;
  userId?: Types.ObjectId;
  sessionId?: string;
  gameId?: Types.ObjectId;
  roomId?: Types.ObjectId;
  properties?: Record<string, any>;
  userAgent?: string;
  ipAddress?: string;
  platform?: string;
  version?: string;
}

export interface PerformanceMetricOptions {
  metricName: string;
  metricType: MetricType;
  value: number;
  tags?: Record<string, string>;
  source: string;
}

export interface ErrorLogOptions {
  errorType: string;
  message: string;
  stack?: string;
  userId?: Types.ObjectId;
  sessionId?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  userAgent?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

export interface AnalyticsQuery {
  startDate: Date;
  endDate: Date;
  eventTypes?: EventType[];
  userId?: Types.ObjectId;
  gameId?: Types.ObjectId;
  roomId?: Types.ObjectId;
}

export interface DashboardMetrics {
  totalEvents: number;
  activeUsers: number;
  averageSessionDuration: number;
  errorRate: number;
  topEvents: { eventType: string; count: number }[];
  userActivity: { date: string; activeUsers: number; totalEvents: number }[];
  performanceMetrics: { metricName: string; avg: number; min: number; max: number }[];
  errorSummary: { errorType: string; count: number; severity: string }[];
}

export class AnalyticsService {
  /**
   * Track an analytics event
   */
  async trackEvent(options: TrackEventOptions): Promise<IAnalyticsEvent> {
    try {
      const event = new AnalyticsEvent({
        eventType: options.eventType,
        userId: options.userId,
        sessionId: options.sessionId,
        gameId: options.gameId,
        roomId: options.roomId,
        properties: options.properties || {},
        userAgent: options.userAgent,
        ipAddress: options.ipAddress,
        platform: options.platform,
        version: options.version,
        timestamp: new Date()
      });

      return await event.save();
    } catch (error) {
      console.error('Failed to track analytics event:', error);
      throw error;
    }
  }

  /**
   * Record a performance metric
   */
  async recordMetric(options: PerformanceMetricOptions): Promise<IPerformanceMetric> {
    try {
      const metric = new PerformanceMetric({
        metricName: options.metricName,
        metricType: options.metricType,
        value: options.value,
        tags: options.tags || {},
        source: options.source,
        timestamp: new Date()
      });

      return await metric.save();
    } catch (error) {
      console.error('Failed to record performance metric:', error);
      throw error;
    }
  }

  /**
   * Log an error
   */
  async logError(options: ErrorLogOptions): Promise<IErrorLog> {
    try {
      const errorLog = new ErrorLog({
        errorType: options.errorType,
        message: options.message,
        stack: options.stack,
        userId: options.userId,
        sessionId: options.sessionId,
        endpoint: options.endpoint,
        method: options.method,
        statusCode: options.statusCode,
        userAgent: options.userAgent,
        severity: options.severity || 'medium',
        timestamp: new Date(),
        resolved: false
      });

      return await errorLog.save();
    } catch (error) {
      console.error('Failed to log error:', error);
      throw error;
    }
  }

  /**
   * Get analytics data for dashboard
   */
  async getDashboardMetrics(startDate: Date, endDate: Date): Promise<DashboardMetrics> {
    try {
      const [
        eventCounts,
        userActivity,
        performanceStats,
        errorSummary,
        totalEvents,
        uniqueUsers
      ] = await Promise.all([
        AnalyticsEvent.getEventCounts(startDate, endDate),
        AnalyticsEvent.getUserActivity(startDate, endDate),
        this.getPerformanceMetricsSummary(startDate, endDate),
        this.getErrorSummary(startDate, endDate),
        AnalyticsEvent.countDocuments({
          timestamp: { $gte: startDate, $lte: endDate }
        }),
        AnalyticsEvent.distinct('userId', {
          timestamp: { $gte: startDate, $lte: endDate },
          userId: { $exists: true }
        })
      ]);

      // Calculate average session duration
      const sessionDurations = await this.calculateAverageSessionDuration(startDate, endDate);
      
      // Calculate error rate
      const errorCount = await ErrorLog.countDocuments({
        timestamp: { $gte: startDate, $lte: endDate }
      });
      const errorRate = totalEvents > 0 ? (errorCount / totalEvents) * 100 : 0;

      return {
        totalEvents,
        activeUsers: uniqueUsers.length,
        averageSessionDuration: sessionDurations,
        errorRate,
        topEvents: eventCounts.map((event: any) => ({
          eventType: event._id,
          count: event.count
        })),
        userActivity: userActivity.map((activity: any) => ({
          date: activity._id,
          activeUsers: activity.activeUsers,
          totalEvents: activity.totalEvents
        })),
        performanceMetrics: performanceStats,
        errorSummary: errorSummary.map((error: any) => ({
          errorType: error._id.errorType,
          count: error.count,
          severity: error._id.severity
        }))
      };
    } catch (error) {
      console.error('Failed to get dashboard metrics:', error);
      throw error;
    }
  }

  /**
   * Get events with filtering and pagination
   */
  async getEvents(
    query: AnalyticsQuery,
    page: number = 1,
    limit: number = 100
  ): Promise<{ events: IAnalyticsEvent[]; total: number; pages: number }> {
    try {
      const filter: any = {
        timestamp: { $gte: query.startDate, $lte: query.endDate }
      };

      if (query.eventTypes && query.eventTypes.length > 0) {
        filter.eventType = { $in: query.eventTypes };
      }

      if (query.userId) {
        filter.userId = query.userId;
      }

      if (query.gameId) {
        filter.gameId = query.gameId;
      }

      if (query.roomId) {
        filter.roomId = query.roomId;
      }

      const skip = (page - 1) * limit;
      
      const [events, total] = await Promise.all([
        AnalyticsEvent.find(filter)
          .populate('userId', 'username')
          .populate('gameId', 'phase dayNumber')
          .populate('roomId', 'code')
          .sort({ timestamp: -1 })
          .skip(skip)
          .limit(limit),
        AnalyticsEvent.countDocuments(filter)
      ]);

      return {
        events,
        total,
        pages: Math.ceil(total / limit)
      };
    } catch (error) {
      console.error('Failed to get events:', error);
      throw error;
    }
  }

  /**
   * Get performance metrics summary
   */
  private async getPerformanceMetricsSummary(startDate: Date, endDate: Date) {
    try {
      const metrics = await PerformanceMetric.aggregate([
        {
          $match: {
            timestamp: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: '$metricName',
            avg: { $avg: '$value' },
            min: { $min: '$value' },
            max: { $max: '$value' },
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ]);

      return metrics.map((metric: any) => ({
        metricName: metric._id,
        avg: Math.round(metric.avg * 100) / 100,
        min: metric.min,
        max: metric.max
      }));
    } catch (error) {
      console.error('Failed to get performance metrics summary:', error);
      return [];
    }
  }

  /**
   * Get error summary
   */
  private async getErrorSummary(startDate: Date, endDate: Date) {
    try {
      return await ErrorLog.aggregate([
        {
          $match: {
            timestamp: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: {
              errorType: '$errorType',
              severity: '$severity'
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ]);
    } catch (error) {
      console.error('Failed to get error summary:', error);
      return [];
    }
  }

  /**
   * Calculate average session duration
   */
  private async calculateAverageSessionDuration(startDate: Date, endDate: Date): Promise<number> {
    try {
      const sessions = await AnalyticsEvent.aggregate([
        {
          $match: {
            timestamp: { $gte: startDate, $lte: endDate },
            sessionId: { $exists: true },
            eventType: { $in: [EventType.USER_LOGIN, EventType.USER_LOGOUT] }
          }
        },
        {
          $group: {
            _id: '$sessionId',
            events: {
              $push: {
                eventType: '$eventType',
                timestamp: '$timestamp'
              }
            }
          }
        }
      ]);

      let totalDuration = 0;
      let validSessions = 0;

      sessions.forEach((session: any) => {
        const loginEvent = session.events.find((e: any) => e.eventType === EventType.USER_LOGIN);
        const logoutEvent = session.events.find((e: any) => e.eventType === EventType.USER_LOGOUT);

        if (loginEvent && logoutEvent) {
          const duration = new Date(logoutEvent.timestamp).getTime() - new Date(loginEvent.timestamp).getTime();
          totalDuration += duration;
          validSessions++;
        }
      });

      return validSessions > 0 ? Math.round(totalDuration / validSessions / 1000) : 0; // Return in seconds
    } catch (error) {
      console.error('Failed to calculate average session duration:', error);
      return 0;
    }
  }

  /**
   * Export analytics data
   */
  async exportData(
    query: AnalyticsQuery,
    format: 'json' | 'csv' = 'json'
  ): Promise<any> {
    try {
      const filter: any = {
        timestamp: { $gte: query.startDate, $lte: query.endDate }
      };

      if (query.eventTypes && query.eventTypes.length > 0) {
        filter.eventType = { $in: query.eventTypes };
      }

      if (query.userId) {
        filter.userId = query.userId;
      }

      const events = await AnalyticsEvent.find(filter)
        .populate('userId', 'username')
        .populate('gameId', 'phase dayNumber')
        .populate('roomId', 'code')
        .sort({ timestamp: -1 })
        .lean();

      if (format === 'csv') {
        return this.convertToCSV(events);
      }

      return events;
    } catch (error) {
      console.error('Failed to export data:', error);
      throw error;
    }
  }

  /**
   * Convert data to CSV format
   */
  private convertToCSV(data: any[]): string {
    if (data.length === 0) return '';

    const headers = ['timestamp', 'eventType', 'userId', 'gameId', 'roomId', 'properties'];
    const csvRows = [headers.join(',')];

    data.forEach(row => {
      const values = [
        row.timestamp,
        row.eventType,
        row.userId?.username || '',
        row.gameId?._id || '',
        row.roomId?.code || '',
        JSON.stringify(row.properties || {})
      ];
      csvRows.push(values.map(value => `"${value}"`).join(','));
    });

    return csvRows.join('\n');
  }

  /**
   * Create A/B test experiment
   */
  async createExperiment(experimentData: {
    name: string;
    description: string;
    variants: { name: string; weight: number; config: Record<string, any> }[];
    startDate: Date;
    endDate?: Date;
    targetAudience: {
      userSegments?: string[];
      percentage?: number;
      conditions?: Record<string, any>;
    };
    metrics: {
      primary: string;
      secondary: string[];
    };
    createdBy: Types.ObjectId;
  }): Promise<IExperiment> {
    try {
      // Validate that variant weights sum to 100
      const totalWeight = experimentData.variants.reduce((sum, variant) => sum + variant.weight, 0);
      if (totalWeight !== 100) {
        throw new Error('Variant weights must sum to 100');
      }

      const experiment = new Experiment(experimentData);
      return await experiment.save();
    } catch (error) {
      console.error('Failed to create experiment:', error);
      throw error;
    }
  }

  /**
   * Assign user to experiment variant
   */
  async assignUserToExperiment(
    userId: Types.ObjectId,
    experimentId: Types.ObjectId
  ): Promise<IUserExperiment | null> {
    try {
      // Check if user is already assigned
      const existingAssignment = await UserExperiment.findOne({ userId, experimentId });
      if (existingAssignment) {
        return existingAssignment;
      }

      // Get experiment details
      const experiment = await Experiment.findById(experimentId);
      if (!experiment || !experiment.isActive) {
        return null;
      }

      // Check if experiment is within date range
      const now = new Date();
      if (now < experiment.startDate || (experiment.endDate && now > experiment.endDate)) {
        return null;
      }

      // Assign variant based on weights
      const random = Math.random() * 100;
      let cumulativeWeight = 0;
      let selectedVariant = experiment.variants[0].name;

      for (const variant of experiment.variants) {
        cumulativeWeight += variant.weight;
        if (random <= cumulativeWeight) {
          selectedVariant = variant.name;
          break;
        }
      }

      const assignment = new UserExperiment({
        userId,
        experimentId,
        variant: selectedVariant,
        assignedAt: new Date()
      });

      await assignment.save();

      // Track experiment view event
      await this.trackEvent({
        eventType: EventType.EXPERIMENT_VIEW,
        userId,
        properties: {
          experimentId: experimentId.toString(),
          experimentName: experiment.name,
          variant: selectedVariant
        }
      });

      return assignment;
    } catch (error) {
      console.error('Failed to assign user to experiment:', error);
      throw error;
    }
  }

  /**
   * Record experiment conversion
   */
  async recordConversion(
    userId: Types.ObjectId,
    experimentId: Types.ObjectId,
    conversionValue?: number
  ): Promise<boolean> {
    try {
      const assignment = await UserExperiment.findOne({ userId, experimentId });
      if (!assignment || assignment.convertedAt) {
        return false;
      }

      assignment.convertedAt = new Date();
      if (conversionValue !== undefined) {
        assignment.conversionValue = conversionValue;
      }

      await assignment.save();

      // Track conversion event
      const experiment = await Experiment.findById(experimentId);
      await this.trackEvent({
        eventType: EventType.EXPERIMENT_CONVERSION,
        userId,
        properties: {
          experimentId: experimentId.toString(),
          experimentName: experiment?.name,
          variant: assignment.variant,
          conversionValue
        }
      });

      return true;
    } catch (error) {
      console.error('Failed to record conversion:', error);
      throw error;
    }
  }

  /**
   * Get experiment results
   */
  async getExperimentResults(experimentId: Types.ObjectId) {
    try {
      const experiment = await Experiment.findById(experimentId);
      if (!experiment) {
        throw new Error('Experiment not found');
      }

      const results = await UserExperiment.aggregate([
        { $match: { experimentId } },
        {
          $group: {
            _id: '$variant',
            totalAssignments: { $sum: 1 },
            conversions: {
              $sum: { $cond: [{ $ne: ['$convertedAt', null] }, 1, 0] }
            },
            totalConversionValue: {
              $sum: { $ifNull: ['$conversionValue', 0] }
            }
          }
        },
        {
          $project: {
            variant: '$_id',
            totalAssignments: 1,
            conversions: 1,
            conversionRate: {
              $multiply: [
                { $divide: ['$conversions', '$totalAssignments'] },
                100
              ]
            },
            totalConversionValue: 1,
            avgConversionValue: {
              $cond: [
                { $gt: ['$conversions', 0] },
                { $divide: ['$totalConversionValue', '$conversions'] },
                0
              ]
            }
          }
        }
      ]);

      return {
        experiment,
        results
      };
    } catch (error) {
      console.error('Failed to get experiment results:', error);
      throw error;
    }
  }

  /**
   * Clean up old analytics data
   */
  async cleanupOldData(retentionDays: number = 90): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const [eventsDeleted, metricsDeleted, errorsDeleted] = await Promise.all([
        AnalyticsEvent.deleteMany({ timestamp: { $lt: cutoffDate } }),
        PerformanceMetric.deleteMany({ timestamp: { $lt: cutoffDate } }),
        ErrorLog.deleteMany({ 
          timestamp: { $lt: cutoffDate },
          resolved: true 
        })
      ]);

      console.log(`Cleaned up analytics data: ${eventsDeleted.deletedCount} events, ${metricsDeleted.deletedCount} metrics, ${errorsDeleted.deletedCount} errors`);
    } catch (error) {
      console.error('Failed to cleanup old data:', error);
      throw error;
    }
  }
}

export const analyticsService = new AnalyticsService();