/*
(1.) Core type definitions for cascade delete configuration and operations
(2.) Establishes the contract between component and consuming applications
(3.) Provides type safety for relationship declarations and deletion operations

This module defines the fundamental types used throughout the cascading delete
component. The CascadeRule type represents a single relationship between tables,
specifying the target table and the index to traverse. The CascadeConfig type
maps source tables to their cascade rules, forming a complete deletion graph.
These types ensure compile-time safety and enable proper TypeScript inference
across the component boundary while maintaining flexibility for various schema
structures and relationship patterns.
*/

/**
 * Represents a single cascade relationship from one table to another.
 * 
 * @property to - The target table name where related documents exist
 * @property via - The index name on the target table used to find related documents
 * 
 * @example
 * { to: "posts", via: "by_author" }
 * // When deleting a user, find posts using the "by_author" index
 */
export type CascadeRule = {
  to: string;
  via: string;
};

/**
 * Complete cascade configuration mapping source tables to their cascade rules.
 * 
 * @example
 * {
 *   users: [
 *     { to: "posts", via: "by_author" },
 *     { to: "comments", via: "by_author" }
 *   ],
 *   posts: [
 *     { to: "comments", via: "by_post" }
 *   ]
 * }
 */
export interface CascadeConfig {
  [sourceTable: string]: CascadeRule[];
}

/**
 * Summary of documents deleted during a cascade operation.
 * Maps table names to the count of documents deleted from each table.
 * 
 * @example
 * { users: 1, posts: 5, comments: 23, likes: 47 }
 */
export type DeletionSummary = {
  [tableName: string]: number;
};

/**
 * Internal representation of a document to be deleted.
 * Tracks the table name and document ID for deletion operations.
 */
export type DeletionTarget = {
  table: string;
  id: string;
};
