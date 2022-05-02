import { graphql } from 'gatsby'
import '../styles.css'

const ComponentName = ({ data }) => <pre>1 {JSON.stringify(data, null, 4)}</pre>

export const query = graphql`
  {
    site {
      buildTime
    }
  }
`

export default ComponentName
