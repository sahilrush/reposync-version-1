"use client"

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import UseProject from '@/hooks/use-project'
import Image from 'next/image'
import React from 'react'
import { readStreamableValue } from 'ai/rsc'
import { askQuestion } from './actions'
import { Loader2, FileText, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'

const AskQuestionCard = () => {
    const { project } = UseProject()
    const [question, setQuestion] = React.useState('')
    const [open, setOpen] = React.useState(false)
    const [loading, setLoading] = React.useState(false)
    const [filesReferences, setFilesReferences] = React.useState<{fileName:string, sourceCode:string, summary:string}[]>([])
    const [answer, setAnswer] = React.useState('')  

    const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if(!project?.id) return
        setLoading(true)
        setOpen(true)
        setAnswer('')  // Clear previous answer

        try {
            const {output, filesReferences} = await askQuestion(question, project.id)
            setFilesReferences(filesReferences)

            for await (const delta of readStreamableValue(output)) {  
                if(delta){
                    setAnswer(ans => ans + delta)
                }
            }
        } catch (error) {
            setAnswer("Sorry, there was an error processing your question. Please try again.")
        } finally {
            setLoading(false)
        }
    }

    return (
        <>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
                    <DialogHeader className="flex flex-row items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Image src='/logo67.png' alt='logo' width={40} height={40} />
                            <DialogTitle className="text-xl">AI Response</DialogTitle>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
                            <X className="h-4 w-4" />
                        </Button>
                    </DialogHeader>

                    <div className="flex flex-1 gap-4 h-full">
                        {/* Main content area */}
                        <ScrollArea className="flex-1 p-4 rounded-lg border">
                            {loading ? (
                                <div className="flex items-center justify-center h-full">
                                    <Loader2 className="h-8 w-8 animate-spin" />
                                </div>
                            ) : (
                                <ReactMarkdown 
                                    className="prose prose-sm max-w-none dark:prose-invert"
                                    components={{
                                        pre: ({ node, ...props }) => (
                                            <div className="relative">
                                                <pre {...props} className="bg-gray-100 p-4 rounded-lg overflow-auto" />
                                            </div>
                                        ),
                                    }}
                                >
                                    {answer}
                                </ReactMarkdown>
                            )}
                        </ScrollArea>

                        {/* File references sidebar */}
                        <div className="w-64 border rounded-lg p-4">
                            <h3 className="font-semibold mb-3 flex items-center gap-2">
                                <FileText className="h-4 w-4" />
                                Referenced Files
                            </h3>
                            <div className="flex flex-col gap-2">
                                {filesReferences.map((file, index) => (
                                    <Badge 
                                        key={index} 
                                        variant="secondary"
                                        className="justify-start text-xs py-2 px-3 cursor-pointer hover:bg-gray-100"
                                        title={file.summary}
                                    >
                                        {file.fileName.split('/').pop()}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    </div>
                </DialogContent> 
            </Dialog>

            <Card className="relative col-span-3 shadow-md hover:shadow-lg transition-shadow">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Image src='/logo67.png' alt='logo' width={30} height={30} />
                        Ask about your codebase
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={onSubmit} className="space-y-4">
                        <Textarea 
                            placeholder="Ask anything about your codebase. For example: 'How do I implement user authentication?' or 'What's the purpose of the auth middleware?'"
                            value={question} 
                            onChange={e => setQuestion(e.target.value)}
                            className="min-h-[100px] resize-none"
                        />
                        <Button 
                            type="submit" 
                            className="w-full"
                            disabled={loading || !question.trim()}
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Analyzing...
                                </>
                            ) : (
                                'Ask Reposync'
                            )}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </>
    )
}

export default AskQuestionCard
