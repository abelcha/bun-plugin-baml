class Resume {
  name string
  email string?
  skills string[]
}

client<llm> Kimi {
  provider openai-generic
  options {
    base_url "https://api.moonshot.ai/v1"
    api_key env.MOONSHOT_API_KEY
    model "kimi-k2.6"
  }
}

function ExtractResume(text: string) -> Resume {
  client Kimi
  prompt #"
    Extract the resume info from the text below.

    {{ ctx.output_format }}

    Text:
    {{ text }}
  "#
}
