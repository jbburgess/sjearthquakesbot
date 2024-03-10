# redditbot-sjearthquakes
[![GitHub Actions](https://github.com/jbburgess/redditbot-sjearthquakes/actions/workflows/master_redditbot-sjearthquakes.yml/badge.svg)](https://github.com/jbburgess/redditbot-sjearthquakes/actions/workflows/master_redditbot-sjearthquakes.yml)

## Table of Contents

- [Overview](#overview)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Running the bot locally](#running-the-bot-locally)
  - [Deploying the bot to Azure](#deploying-the-bot-to-azure)
- [Authors](#authors)

## Overview

A collection of Azure functions for the San Jose Earthquakes subreddit bot. The bot is designed to provide automated functionality for the subreddit, including:

- Post, sticky, and unsticky matchday threads (Pre-Match, Match, Post-Match, and Man of the Match) at the appropriate times.
- Post news articles from the official SJEarthquakes.com website as they're announced.

The bot is designed to be run as an Azure Function App, and is written in Python. The bot contains the following Azure Functions:

- `get_schedule`: A timer-triggered function that checks the match schedule and triggers the `post_match_thread` function as needed.
- `post_match_thread`: An HTTP-triggered function that posts match threads on-demand.
- `post_news`: A timer-triggered function that checks for and posts news articles from the official SJEarthquakes.com website.

The bot uses the following external services:

- [Reddit](https://www.reddit.com): The bot uses the Reddit API to post and manage submissions.
- [SJEarthquakes.com](https://www.sjearthquakes.com): The bot scrapes news articles from the official San Jose Earthquakes website.

The bot uses the following Python packages:

- [beautifulsoup4](https://pypi.org/project/beautifulsoup4/): For parsing HTML and XML documents.
- [icalendar](https://pypi.org/project/icalendar/): For parsing .ics files.
- [praw](https://pypi.org/project/praw/): For interacting with the Reddit API.
- [requests](https://pypi.org/project/requests/): For making HTTP requests.

The bot expects the following environment variables to be set:
*(As Application Settings in Azure, or in a `local.settings.json` file for local development)*

- `NewsSite_BaseURL`: The base URL of the news site.
- `NewsSite_NewsURL`: The URL sub-path for news articles.
- `NewsSite_MaxArticles`: The maximum number of articles to retrieve.
- `NewsSite_ArticleCutoffDays`: The number of days after which articles are considered outdated.
- `Reddit_Connection_UserAgent`: The user agent for the Reddit connection.
- `Reddit_Connection_ClientID`: The client ID for the Reddit connection.
- `Reddit_Connection_ClientSecret`: The client secret for the Reddit connection.
- `Reddit_Connection_Username`: The username for the Reddit connection.
- `Reddit_Connection_Password`: The password for the Reddit connection.
- `Reddit_MatchThread_FunctionURL`: The URL for triggering the match thread function.
- `Reddit_Submission_Resubmit`: Flag indicating whether to resubmit submissions.
- `Reddit_Submission_SendReplies`: Flag indicating whether to send replies to submissions.
- `Reddit_Subreddit`: The subreddit to post in.
- `Schedule_URL`: The URL for the .ics file containing the match schedule.

## Getting Started

### Prerequisites

- [Visual Studio Code](https://code.visualstudio.com/)
- [Azure Functions Extension](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-azurefunctions)
- [Azure Functions Core Tools](https://docs.microsoft.com/en-us/azure/azure-functions/functions-run-local?tabs=windows%2Ccsharp%2Cbash)
- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli?view=azure-cli-latest)

### Running the bot locally

1. Clone the repository
2. Open the repository in Visual Studio Code
3. Open the terminal and run `func start`
4. The bot will be running locally at `http://localhost:7071`

### Deploying the bot to Azure

1. Open the terminal and run `az login`
2. Run `az account set --subscription <subscription-id>`
3. Run `func azure functionapp publish <function-app-name>`
4. The bot will be deployed to Azure and running at `https://<function-app-name>.azurewebsites.net`

## Authors

- **[Jonathan Burgess](https://www.github.com/jbburgess)**
