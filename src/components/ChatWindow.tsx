import { useState, useEffect, useRef, useCallback } from 'react'
import ChatMessage from './ChatMessage'
import ChatInput from './ChatInput'
import ReasoningContent from './ReasoningContent'

type Message = {
  content: string
  isUser: boolean
  reasoning?: string
  isComplete?: boolean
  showReasoning?: boolean
}

export default function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Este useRef armazena o índice da “mensagem final” (se já foi criada)
  const answerMessageIndexRef = useRef<number>(-1)

  // Este useRef diz se já criamos a mensagem final
  const alreadyCreatedRef = useRef<boolean>(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  /**
   * 1. Maneira de inserir raciocínio extra na mensagem final.
   */
  const appendReasoningToFinalMessage = useCallback((reasonChunk: string) => {
    setMessages(prev => {
      const newArr = [...prev]
      const idx = answerMessageIndexRef.current
      if (idx >= 0 && newArr[idx]) {
        // Concatena
        const oldReason = newArr[idx].reasoning || ''
        newArr[idx].reasoning = oldReason + reasonChunk
      }
      return newArr
    })
  }, [])

  /**
   * 2. Maneira de inserir texto (content) na mensagem final.
   */
  const appendContentToFinalMessage = useCallback((contentChunk: string) => {
    setMessages(prev => {
      const newArr = [...prev]
      const idx = answerMessageIndexRef.current
      if (idx >= 0 && newArr[idx]) {
        const oldContent = newArr[idx].content || ''
        newArr[idx].content = oldContent + contentChunk
      }
      return newArr
    })
  }, [])

  /**
   * 3. Cria a mensagem final caso não exista,
   *    incluindo qualquer raciocínio que esteja “em espera” até esse momento.
   */
  const createFinalMessage = useCallback((initialReasoning?: string) => {
    setMessages(prev => {
      const newArr = [...prev]
      newArr.push({
        content: '',
        isUser: false,
        reasoning: initialReasoning || '',
        isComplete: false,
        showReasoning: true
      })
      answerMessageIndexRef.current = newArr.length - 1
      return newArr
    })
  }, [])

  /**
   * 4. Marca a mensagem final como completa
   */
  const finalizeMessage = useCallback(() => {
    setMessages(prev => {
      const newArr = [...prev]
      const idx = answerMessageIndexRef.current
      if (idx >= 0 && newArr[idx]) {
        newArr[idx].isComplete = true
        // showReasoning permanece true
      }
      return newArr
    })
  }, [])

  /**
   * 5. Handle Send
   */
  const handleSend = async (prompt: string) => {
    console.log('[handleSend] => START with prompt=', prompt)

    // Adiciona mensagem do usuário
    setMessages(prev => [
      ...prev,
      { content: prompt, isUser: true }
    ])

    // Reseta flags
    setIsLoading(true)
    answerMessageIndexRef.current = -1
    alreadyCreatedRef.current = false

    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_DEEPSEEK_API_KEY}`,
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          model: 'deepseek-reasoner',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          stream: true,
          show_reasoning: true
        })
      })

      console.log('[handleSend] => response.status=', response.status)

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let finished = false

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            console.log('[handleSend] => reader done')
            break
          }

          const chunk = decoder.decode(value)
          const lines = chunk.split('\n').filter(line => line.trim() !== '')

          for (const line of lines) {
            if (line.trim() === 'data: [DONE]') {
              console.log('[handleSend] => got [DONE]')
              finished = true
              break
            }

            try {
              // remove 'data: '
              const data = JSON.parse(line.replace('data: ', ''))
              const choice = data.choices?.[0]
              if (!choice) continue

              // if finish_reason => paramos
              if (choice.finish_reason) {
                console.log('[handleSend] => finish_reason:', choice.finish_reason)
                finished = true
              }

              // ver delta
              const delta = choice.delta
              if (!delta) continue

              // raciocínio
              if (delta.reasoning_content != null) {
                console.log('[handleSend] => reasoning_content:', delta.reasoning_content)
                if (alreadyCreatedRef.current) {
                  // já existe mensagem final => atualiza lá
                  appendReasoningToFinalMessage(delta.reasoning_content)
                } else {
                  // se ainda não criamos a mensagem, podemos
                  // criar ela contendo esse raciocínio no “reasoning”
                  console.log('[handleSend] => create final message with initial reasoning')
                  createFinalMessage(delta.reasoning_content)
                  alreadyCreatedRef.current = true
                }
              }

              // conteúdo
              if (delta.content != null) {
                console.log('[handleSend] => content:', delta.content)
                // se ainda não criamos a mensagem, criamos agora
                if (!alreadyCreatedRef.current) {
                  console.log('[handleSend] => create final message with NO reasoning yet')
                  createFinalMessage('')
                  alreadyCreatedRef.current = true
                }
                // atualizamos a mensagem final
                appendContentToFinalMessage(delta.content)
              }
            } catch (err) {
              console.error('[handleSend] => error parse chunk:', err)
            }
          }

          if (finished) {
            console.log('[handleSend] => break from loop - finished')
            break
          }
        }
      }

      // finaliza a msg
      finalizeMessage()
    } catch (error) {
      console.error('[handleSend] => error:', error)
      setMessages(prev => [
        ...prev,
        {
          content: `Error: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          isUser: false
        }
      ])
    } finally {
      console.log('[handleSend] => done')
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <div className="flex-1 overflow-y-auto p-4">
        {messages.map((msg, i) => (
          <div key={i}>
            {msg.showReasoning && msg.reasoning && (
              <ReasoningContent content={msg.reasoning} />
            )}
            <ChatMessage message={msg.content} isUser={msg.isUser} />
          </div>
        ))}

        {/* Se está carregando e nada chegou, exibe “digitando…” */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="p-3 rounded-lg bg-gray-200 dark:bg-gray-700 rounded-tl-none">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce delay-100" />
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce delay-200" />
                <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce delay-300" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <ChatInput onSend={handleSend} />
    </div>
  )
}