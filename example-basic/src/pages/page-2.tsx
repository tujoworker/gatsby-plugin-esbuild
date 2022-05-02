// import React from 'react'
import { graphql } from 'gatsby'

const ComponentName = ({ data }) => <pre>2 {JSON.stringify(data, null, 4)}</pre>

export const query = graphql`
  {
    site {
      buildTime
    }
  }
`

export default ComponentName
