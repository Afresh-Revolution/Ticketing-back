-- Migration to add role column to User table
-- Run this migration if the User table already exists

-- Add role column to existing User table
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

-- Add comment explaining role values
COMMENT ON COLUMN "User".role IS 'User role: user (default), admin, superadmin';