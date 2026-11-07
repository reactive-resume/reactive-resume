package me.rxresu.feature.settings

import me.rxresu.core.network.generated.CreateAiProviderRequestProvider as Provider

// New-provider suggestions from @reactive-resume/ai/defaults; saved models always win.
internal val providerNames =
    linkedMapOf(
        Provider.Openai to "OpenAI",
        Provider.Anthropic to "Anthropic Claude",
        Provider.Gemini to "Google Gemini",
        Provider.VercelAiGateway to "Vercel AI Gateway",
        Provider.Openrouter to "OpenRouter",
        Provider.Mistral to "Mistral AI",
        Provider.Cohere to "Cohere",
        Provider.Xai to "xAI Grok",
        Provider.Groq to "Groq",
        Provider.Deepseek to "DeepSeek",
        Provider.Togetherai to "Together.ai",
        Provider.Fireworks to "Fireworks",
        Provider.Cerebras to "Cerebras",
        Provider.Perplexity to "Perplexity",
        Provider.Ollama to "Ollama",
        Provider.OpenaiCompatible to "OpenAI-compatible",
    )
internal val providerDefaults =
    linkedMapOf(
        Provider.Openai to ("gpt-6-luna" to "https://api.openai.com/v1"),
        Provider.Anthropic to ("claude-haiku-5-5" to "https://api.anthropic.com/v1"),
        Provider.Gemini to
            ("gemini-3.5-flash-lite" to "https://generativelanguage.googleapis.com/v1beta"),
        Provider.VercelAiGateway to ("openai/gpt-6-luna" to "https://ai-gateway.vercel.sh/v3/ai"),
        Provider.Openrouter to ("anthropic/claude-haiku-5.5" to "https://openrouter.ai/api/v1"),
        Provider.Mistral to ("mistral-small-latest" to "https://api.mistral.ai/v1"),
        Provider.Cohere to ("command-r7b-12-2024" to "https://api.cohere.com/v2"),
        Provider.Xai to ("grok-4.3" to "https://api.x.ai/v1"),
        Provider.Groq to ("openai/gpt-oss-20b" to "https://api.groq.com/openai/v1"),
        Provider.Deepseek to ("deepseek-flash" to "https://api.deepseek.com/v1"),
        Provider.Togetherai to ("Qwen/Qwen3.8-Flash" to "https://api.together.xyz/v1"),
        Provider.Fireworks to
            ("accounts/fireworks/models/deepseek-v4p1-flash-1017" to
                "https://api.fireworks.ai/inference/v1"),
        Provider.Cerebras to ("qwen-3.8-27b" to "https://api.cerebras.ai/v1"),
        Provider.Perplexity to ("sonar" to "https://api.perplexity.ai"),
        Provider.Ollama to ("gpt-oss:20b-cloud" to "https://ollama.com/api"),
        Provider.OpenaiCompatible to ("" to ""),
    )
internal val providerKeyUrls =
    linkedMapOf(
        Provider.Openai to "https://platform.openai.com/api-keys",
        Provider.Anthropic to "https://platform.claude.com/settings/keys",
        Provider.Gemini to "https://aistudio.google.com/apikey",
        Provider.VercelAiGateway to "https://vercel.com/dashboard/ai-gateway",
        Provider.Openrouter to "https://openrouter.ai/keys",
        Provider.Mistral to "https://console.mistral.ai/api-keys",
        Provider.Cohere to "https://dashboard.cohere.com/api-keys",
        Provider.Xai to "https://console.x.ai/",
        Provider.Groq to "https://console.groq.com/keys",
        Provider.Deepseek to "https://platform.deepseek.com/api_keys",
        Provider.Togetherai to "https://api.together.ai/settings/projects/~current/api-keys",
        Provider.Fireworks to "https://app.fireworks.ai/settings/users/api-keys",
        Provider.Cerebras to "https://cloud.cerebras.ai/platform",
        Provider.Perplexity to "https://console.perplexity.ai/",
        Provider.Ollama to "https://ollama.com/settings/keys",
        Provider.OpenaiCompatible to "",
    )
