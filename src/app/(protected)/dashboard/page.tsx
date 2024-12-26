"use client";

import UseProject from '@/hooks/use-project';
import { ExternalLink, Github, Users, GitBranch, BarChart3, Activity, FileText, Clock } from 'lucide-react';
import Link from 'next/link';
import React from 'react'
import CommitLog from './commit-log';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getProjectStats } from './actions';
import { formatDistanceToNow } from 'date-fns';

const StatCard = ({ 
  icon: Icon, 
  label, 
  value 
}: { 
  icon: any, 
  label: string, 
  value: string | React.ReactNode 
}) => (
  <Card className="bg-primary/5 border-none">
    <CardContent className="p-4">
      <div className="flex items-center gap-2 text-primary mb-1">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="text-lg font-bold">{value}</p>
    </CardContent>
  </Card>
);

const DashboardPage = () => {
  const { project } = UseProject();
  const [stats, setStats] = React.useState<{
    totalFiles: number;
    lastUpdated: Date | null;
    activeBranch: string;
    contributors: number;
    lastCommitSummary: string | null;
  }>({
    totalFiles: 0,
    lastUpdated: null,
    activeBranch: 'main',
    contributors: 0,
    lastCommitSummary: null
  });
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const fetchStats = async () => {
      if (!project?.id) return;

      try {
        // Check if we should fetch new stats
        const lastFetchTime = localStorage.getItem(`stats-last-fetch-${project.id}`);
        const shouldFetch = !lastFetchTime || 
          (new Date().getTime() - new Date(lastFetchTime).getTime()) > 24 * 60 * 60 * 1000;

        if (shouldFetch) {
          setIsLoading(true);
          const projectStats = await getProjectStats(project.id);
          
          // Transform the date before storing
          const statsToStore = {
            ...projectStats,
            lastUpdated: projectStats.lastUpdated ? projectStats.lastUpdated.toISOString() : null
          };
          
          setStats({
            ...projectStats,
            lastUpdated: projectStats.lastUpdated ? new Date(projectStats.lastUpdated) : null
          });
          
          // Store the fetch time and stats
          localStorage.setItem(`stats-last-fetch-${project.id}`, new Date().toISOString());
          localStorage.setItem(`stats-data-${project.id}`, JSON.stringify(statsToStore));
        } else {
          // Use cached stats
          const cachedStats = localStorage.getItem(`stats-data-${project.id}`);
          if (cachedStats) {
            const parsedStats = JSON.parse(cachedStats);
            setStats({
              ...parsedStats,
              lastUpdated: parsedStats.lastUpdated ? new Date(parsedStats.lastUpdated) : null
            });
          }
        }
      } catch (error) {
        console.error('Error fetching or parsing stats:', error);
        // Fetch fresh data if there's an error with cached data
        try {
          setIsLoading(true);
          const projectStats = await getProjectStats(project.id);
          setStats({
            ...projectStats,
            lastUpdated: projectStats.lastUpdated ? new Date(projectStats.lastUpdated) : null
          });
        } catch (e) {
          console.error('Error fetching fresh stats:', e);
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchStats();
  }, [project?.id]);

  const formatLastUpdated = (date: Date | null) => {
    if (!date) return 'Never';
    return formatDistanceToNow(date, { addSuffix: true });
  };

  const formatContributors = (count: number) => {
    return `${count} ${count === 1 ? 'Member' : 'Members'}`;
  };

  const formatValue = (value: string | number) => {
    if (isLoading) {
      return <span className="animate-pulse bg-gray-200 rounded h-6 w-20 inline-block" />;
    }
    return value;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto p-6 space-y-6">
        {/* Project Overview Section */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16 border-2 border-primary">
              <AvatarImage src={project?.imageUrl || ''} />
              <AvatarFallback className="bg-primary/10">{project?.name?.charAt(0)}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-3xl font-bold">{project?.name}</h1>
              <Link 
                href={project?.githubUrl ?? ""} 
                className="flex items-center text-sm text-muted-foreground hover:text-primary mt-1"
                target="_blank"
              >
                <Github className="h-4 w-4 mr-1" />
                View Repository
                <ExternalLink className="h-3 w-3 ml-1" />
              </Link>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard 
            icon={Users} 
            label="Contributors" 
            value={formatValue(formatContributors(stats.contributors))}
          />
          <StatCard 
            icon={FileText} 
            label="Total Files" 
            value={formatValue(`${stats.totalFiles.toLocaleString()} Files`)}
          />
          <StatCard 
            icon={GitBranch} 
            label="Active Branch" 
            value={formatValue(stats.activeBranch)}
          />
          <StatCard 
            icon={Clock} 
            label="Last Updated" 
            value={formatValue(formatLastUpdated(stats.lastUpdated))}
          />
        </div>

        {/* Last Commit Summary */}
        {stats.lastCommitSummary && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                Latest Changes Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {stats.lastCommitSummary}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Recent Activity */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Recent Activity
            </CardTitle>
            <CardDescription>Latest updates and changes to your repository</CardDescription>
          </CardHeader>
          <CardContent>
            <CommitLog />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default DashboardPage 
 