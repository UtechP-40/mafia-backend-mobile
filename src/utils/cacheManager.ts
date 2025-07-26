import { createHash } from 'crypto';

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  maxSize?: number; // Maximum number of entries
  enableStats?: boolean;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  size: number;
  hitRate: number;
}

export interface CacheEntry<T> {
  value: T;
  expiry: number;
  accessCount: number;
  lastAccessed: number;
}

class MemoryCache<T = any> {
  private cache = new Map<string, CacheEntry<T>>();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    size: 0,
    hitRate: 0,
  };
  
  private readonly maxSize: number;
  private readonly defaultTTL: number;
  private readonly enableStats: boolean;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(options: CacheOptions = {}) {
    this.maxSize = options.maxSize || 1000;
    this.defaultTTL = (options.ttl || 300) * 1000; // Convert to milliseconds
    this.enableStats = options.enableStats !== false;
    
    // Start cleanup interval
    this.startCleanup();
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // Cleanup every minute
  }

  private cleanup(): void {
    const now = Date.now();
    let deletedCount = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiry < now) {
        this.cache.delete(key);
        deletedCount++;
      }
    }
    
    if (deletedCount > 0) {
      this.updateStats({ deletes: deletedCount, size: -deletedCount });
    }
  }

  private evictLRU(): void {
    if (this.cache.size === 0) return;
    
    let oldestKey = '';
    let oldestTime = Date.now();
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.updateStats({ deletes: 1, size: -1 });
    }
  }

  private updateStats(updates: Partial<CacheStats>): void {
    if (!this.enableStats) return;
    
    Object.assign(this.stats, updates);
    this.stats.size = this.cache.size;
    this.stats.hitRate = this.stats.hits / (this.stats.hits + this.stats.misses) || 0;
  }

  set(key: string, value: T, ttl?: number): void {
    const expiry = Date.now() + (ttl ? ttl * 1000 : this.defaultTTL);
    
    // Evict if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }
    
    const entry: CacheEntry<T> = {
      value,
      expiry,
      accessCount: 0,
      lastAccessed: Date.now(),
    };
    
    const isNew = !this.cache.has(key);
    this.cache.set(key, entry);
    
    this.updateStats({ 
      sets: 1, 
      size: isNew ? 1 : 0 
    });
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.updateStats({ misses: 1 });
      return undefined;
    }
    
    if (entry.expiry < Date.now()) {
      this.cache.delete(key);
      this.updateStats({ misses: 1, deletes: 1, size: -1 });
      return undefined;
    }
    
    // Update access statistics
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    
    this.updateStats({ hits: 1 });
    return entry.value;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    
    if (!entry) return false;
    
    if (entry.expiry < Date.now()) {
      this.cache.delete(key);
      this.updateStats({ deletes: 1, size: -1 });
      return false;
    }
    
    return true;
  }

  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    
    if (deleted) {
      this.updateStats({ deletes: 1, size: -1 });
    }
    
    return deleted;
  }

  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.updateStats({ deletes: size, size: -size });
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  getSize(): number {
    return this.cache.size;
  }

  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
  }
}

class CacheManager {
  private static instance: CacheManager;
  private caches = new Map<string, MemoryCache>();

  static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  createCache<T>(name: string, options: CacheOptions = {}): MemoryCache<T> {
    if (this.caches.has(name)) {
      return this.caches.get(name)! as MemoryCache<T>;
    }

    const cache = new MemoryCache<T>(options);
    this.caches.set(name, cache);
    return cache;
  }

  getCache<T>(name: string): MemoryCache<T> | undefined {
    return this.caches.get(name) as MemoryCache<T> | undefined;
  }

  destroyCache(name: string): boolean {
    const cache = this.caches.get(name);
    if (cache) {
      cache.destroy();
      return this.caches.delete(name);
    }
    return false;
  }

  getAllCacheStats(): Record<string, CacheStats> {
    const stats: Record<string, CacheStats> = {};
    
    for (const [name, cache] of this.caches.entries()) {
      stats[name] = cache.getStats();
    }
    
    return stats;
  }

  clearAllCaches(): void {
    for (const cache of this.caches.values()) {
      cache.clear();
    }
  }

  destroyAllCaches(): void {
    for (const [name, cache] of this.caches.entries()) {
      cache.destroy();
    }
    this.caches.clear();
  }
}

export const cacheManager = CacheManager.getInstance();

// Specialized caches for different data types
export const playerCache = cacheManager.createCache('players', {
  ttl: 300, // 5 minutes
  maxSize: 1000,
});

export const gameCache = cacheManager.createCache('games', {
  ttl: 60, // 1 minute (games change frequently)
  maxSize: 500,
});

export const roomCache = cacheManager.createCache('rooms', {
  ttl: 30, // 30 seconds (rooms change very frequently)
  maxSize: 200,
});

export const leaderboardCache = cacheManager.createCache('leaderboards', {
  ttl: 600, // 10 minutes
  maxSize: 50,
});

// Cache decorators and utilities
export function cached<T extends (...args: any[]) => Promise<any>>(
  cacheName: string,
  keyGenerator: (...args: Parameters<T>) => string,
  ttl?: number
) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    const cache = cacheManager.getCache(cacheName) || cacheManager.createCache(cacheName);

    descriptor.value = async function (...args: Parameters<T>) {
      const cacheKey = keyGenerator(...args);
      
      // Try to get from cache first
      const cachedResult = cache.get(cacheKey);
      if (cachedResult !== undefined) {
        return cachedResult;
      }

      // Execute the original method
      const result = await method.apply(this, args);
      
      // Cache the result
      cache.set(cacheKey, result, ttl);
      
      return result;
    };

    return descriptor;
  };
}

// Cache key generators
export const generateCacheKey = {
  player: (playerId: string) => `player:${playerId}`,
  playerStats: (playerId: string) => `player:stats:${playerId}`,
  game: (gameId: string) => `game:${gameId}`,
  room: (roomId: string) => `room:${roomId}`,
  roomList: (filters: any) => `rooms:${createHash('md5').update(JSON.stringify(filters)).digest('hex')}`,
  leaderboard: (type: string, limit: number) => `leaderboard:${type}:${limit}`,
  playerFriends: (playerId: string) => `player:friends:${playerId}`,
  gameHistory: (playerId: string, page: number) => `player:history:${playerId}:${page}`,
};

// Cache warming utilities
export class CacheWarmer {
  private static warmingTasks = new Map<string, NodeJS.Timeout>();

  static scheduleWarming(
    cacheName: string,
    warmingFunction: () => Promise<void>,
    intervalMs: number
  ): void {
    // Clear existing warming task
    const existingTask = this.warmingTasks.get(cacheName);
    if (existingTask) {
      clearInterval(existingTask);
    }

    // Schedule new warming task
    const task = setInterval(async () => {
      try {
        await warmingFunction();
        console.log(`Cache warmed: ${cacheName}`);
      } catch (error) {
        console.error(`Cache warming failed for ${cacheName}:`, error);
      }
    }, intervalMs);

    this.warmingTasks.set(cacheName, task);
  }

  static stopWarming(cacheName: string): void {
    const task = this.warmingTasks.get(cacheName);
    if (task) {
      clearInterval(task);
      this.warmingTasks.delete(cacheName);
    }
  }

  static stopAllWarming(): void {
    for (const [cacheName, task] of this.warmingTasks.entries()) {
      clearInterval(task);
    }
    this.warmingTasks.clear();
  }
}

// Cache middleware for Express
export const cacheMiddleware = (
  cacheName: string,
  keyGenerator: (req: any) => string,
  ttl?: number
) => {
  const cache = cacheManager.getCache(cacheName) || cacheManager.createCache(cacheName);

  return (req: any, res: any, next: any) => {
    const cacheKey = keyGenerator(req);
    const cachedResponse = cache.get(cacheKey);

    if (cachedResponse) {
      return res.json(cachedResponse);
    }

    // Override res.json to cache the response
    const originalJson = res.json;
    res.json = function (data: any) {
      cache.set(cacheKey, data, ttl);
      return originalJson.call(this, data);
    };

    next();
  };
};